"""Periodic S3-compatible state backup for bandit-orchestrator.

Bandit state JSON lives at `BANDIT_DATA_DIR/{bandit_id}.json` on the
container's filesystem. A container restart that loses the volume
loses every workspace's Thompson posteriors — registered arms,
allocation counts, reward history, prune flags, all of it. This
module ships an optional periodic upload of every state file to an
S3-compatible bucket so a restart can be made non-lossy by restoring
the manifest before the lifespan rescan runs.

Failure semantics (matches producer.py / consumer.py):
  - boto3 missing (the [runtime] extra wasn't installed) → log warn +
    degrade to disabled. The orchestrator keeps allocating, just
    without backups.
  - BANDIT_BACKUP_ENABLED unset / "false" → start() is a no-op.
  - Single put failure → logged + counted; the loop keeps going.
    Beats crashing the backup task on one S3 hiccup (Wasabi 503,
    R2 transient timeout, etc.).
  - Final flush on stop() so a graceful shutdown isn't lossy.

The S3 layout is intentionally human-debuggable:
  s3://<bucket>/<prefix>/<bandit_id>.json    — one object per bandit,
                                                 same shape as on-disk
  s3://<bucket>/<prefix>/_manifest.json      — single index file with
                                                 every bandit's
                                                 last-modified ts +
                                                 sha256 for integrity
                                                 verification on restore

Restore is trivially scriptable from the manifest — see BACKUP.md.

S3-compatible providers: AWS S3, Cloudflare R2, MinIO, Wasabi all
work out of the box because boto3 honours the AWS env vars + the
optional `BANDIT_BACKUP_S3_ENDPOINT_URL` override pointed at the
provider's S3 endpoint.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger()


def _data_dir() -> Path:
    """Read DATA_DIR fresh each time so we honour test overrides of
    BANDIT_DATA_DIR. Mirrors main.py's resolution semantics — same env
    var, same default."""
    return Path(os.getenv("BANDIT_DATA_DIR", "/data/bandits"))


def _scan_state_paths() -> list[Path]:
    """Walk DATA_DIR and return every *.json that looks like a bandit
    state file. We deliberately read independently rather than calling
    main._scan_state_files so the backup module has no circular import
    on main and stays self-contained.

    Skips half-written .tmp files the atomic-replace pattern leaves
    behind. Tolerates a missing DATA_DIR (returns empty list — the
    backup loop is a no-op until a bandit registers).
    """
    data_dir = _data_dir()
    if not data_dir.exists():
        return []
    out: list[Path] = []
    for path in data_dir.glob("*.json"):
        if path.name.endswith(".tmp"):
            continue
        # Skip our own manifest if anyone ever syncs S3 contents back
        # locally — defensive even though the manifest only ever lives
        # on S3.
        if path.name == "_manifest.json":
            continue
        out.append(path)
    return out


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class StateBackup:
    """Periodic S3 uploader for bandit state JSON.

    State machine:
      INIT      → start() →  RUNNING (background task ticking)
      RUNNING   → stop()  →  STOPPED (final flush done)
      <any> + start error → DISABLED (run loop never starts)

    Like the consumer + producer, the failure paths degrade rather
    than crash. The orchestrator's main work (allocate / reward) must
    never depend on a successful S3 put.
    """

    def __init__(self) -> None:
        self._client: Any | None = None
        self._task: asyncio.Task[None] | None = None
        self._enabled: bool = False
        self._bucket: str = ""
        self._prefix: str = ""
        self._endpoint_url: str | None = None
        self._region: str | None = None
        self._interval_seconds: int = 300
        self._last_run_at: str | None = None
        self._last_run_uploaded: int = 0
        self._last_run_failed: int = 0
        self._total_uploads: int = 0
        self._total_failures: int = 0
        self._total_runs: int = 0
        self._stop_event: asyncio.Event | None = None

    @staticmethod
    def _read_env_flag(name: str, default: str) -> bool:
        return os.getenv(name, default).lower() == "true"

    @staticmethod
    def _normalize_prefix(raw: str) -> str:
        """Strip leading slashes and ensure exactly one trailing slash so
        '<prefix><bandit_id>.json' composes cleanly regardless of how
        the caller wrote the env var ('bandits', 'bandits/', '/bandits',
        '/bandits/' all behave identically)."""
        cleaned = raw.strip().lstrip("/")
        if not cleaned:
            return ""
        if not cleaned.endswith("/"):
            cleaned += "/"
        return cleaned

    async def start(self) -> None:
        if not self._read_env_flag("BANDIT_BACKUP_ENABLED", "false"):
            log.info("backup.disabled", reason="BANDIT_BACKUP_ENABLED=false")
            return

        bucket = os.getenv("BANDIT_BACKUP_S3_BUCKET", "").strip()
        if not bucket:
            log.warning(
                "backup.config_missing",
                reason="BANDIT_BACKUP_S3_BUCKET unset",
                hint="Set BANDIT_BACKUP_S3_BUCKET to enable backups.",
            )
            return

        # Lazy import — matches producer.py / consumer.py. Keeps the
        # base service importable in environments that didn't install
        # the [runtime] extra (CI lint, local dev without S3, etc.).
        try:
            from boto3 import client as boto3_client
        except ImportError as e:
            log.warning(
                "backup.boto3_missing",
                error=str(e),
                hint="Install with `uv pip install --system .[runtime]`",
            )
            return

        self._bucket = bucket
        self._prefix = self._normalize_prefix(os.getenv("BANDIT_BACKUP_S3_PREFIX", "bandits/"))
        self._endpoint_url = os.getenv("BANDIT_BACKUP_S3_ENDPOINT_URL") or None
        self._region = os.getenv("AWS_REGION") or None

        try:
            interval_raw = os.getenv("BANDIT_BACKUP_INTERVAL_SECONDS", "300")
            self._interval_seconds = max(int(interval_raw), 1)
        except ValueError:
            log.warning(
                "backup.bad_interval",
                value=os.getenv("BANDIT_BACKUP_INTERVAL_SECONDS"),
                fallback=300,
            )
            self._interval_seconds = 300

        try:
            client_kwargs: dict[str, Any] = {}
            if self._endpoint_url:
                client_kwargs["endpoint_url"] = self._endpoint_url
            if self._region:
                client_kwargs["region_name"] = self._region
            # boto3 picks up AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
            # from the env without any explicit wiring; we don't pass
            # them through so they're never logged or held in memory
            # at this layer.
            self._client = boto3_client("s3", **client_kwargs)
        except Exception as e:
            log.error(
                "backup.client_init_failed",
                bucket=self._bucket,
                error=str(e),
                hint="Service runs degraded; bandit state not backed up.",
            )
            return

        self._enabled = True
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._run_loop())
        log.info(
            "backup.started",
            bucket=self._bucket,
            prefix=self._prefix,
            interval_seconds=self._interval_seconds,
            endpoint_url=self._endpoint_url,
            region=self._region,
        )

    async def stop(self) -> None:
        """Cancel the background task + run a final flush so the most
        recent posterior updates land in S3 before the container exits.
        Fail-soft on every step — shutdown should never raise."""
        if self._stop_event:
            self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                log.warning("backup.task_join_failed", error=str(e))
            self._task = None
        if self._enabled and self._client is not None:
            try:
                await self._run_once()
                log.info(
                    "backup.final_flush",
                    uploaded=self._last_run_uploaded,
                    failed=self._last_run_failed,
                )
            except Exception as e:
                log.warning("backup.final_flush_failed", error=str(e))
        self._enabled = False
        self._client = None
        self._stop_event = None

    @property
    def is_enabled(self) -> bool:
        return self._enabled

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "bucket": self._bucket if self._enabled else "",
            "prefix": self._prefix if self._enabled else "",
            "interval_seconds": self._interval_seconds,
            "last_run_at": self._last_run_at,
            "last_run_uploaded_count": self._last_run_uploaded,
            "last_run_failed_count": self._last_run_failed,
            "total_uploads": self._total_uploads,
            "total_failures": self._total_failures,
            "total_runs": self._total_runs,
        }

    async def _run_loop(self) -> None:
        """Tick every INTERVAL_SECONDS, run one backup pass per tick.
        Uses an Event.wait() with timeout so stop() can break us out of
        the sleep cleanly rather than waiting for the next interval to
        expire. Never raises — every per-tick exception is logged and
        the loop continues."""
        assert self._stop_event is not None
        try:
            while not self._stop_event.is_set():
                try:
                    await self._run_once()
                except Exception as e:
                    # Defensive — _run_once already swallows per-put
                    # failures, so reaching here means something
                    # systemic (DNS, auth, etc.). Log + keep ticking.
                    log.warning("backup.run_failed", error=str(e))
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=float(self._interval_seconds),
                    )
                    # Event was set → exit the loop cleanly.
                    return
                except TimeoutError:
                    # Normal path — tick interval elapsed, run again.
                    # asyncio.wait_for raises the builtin TimeoutError
                    # on Python 3.11+ (formerly asyncio.TimeoutError).
                    continue
        except asyncio.CancelledError:
            raise

    async def _run_once(self) -> None:
        """Single pass: scan DATA_DIR, upload each state file to S3,
        write the manifest with last-modified + sha256 per bandit.

        S3 put failures are logged + counted; the loop keeps going so
        one bad bandit doesn't block the rest. The manifest is written
        last so a partial-failure run still leaves a coherent index of
        what actually made it up.
        """
        if not self._enabled or self._client is None:
            return
        loop = asyncio.get_running_loop()
        run_started = datetime.now(UTC).isoformat()
        uploaded = 0
        failed = 0
        manifest_entries: list[dict[str, Any]] = []

        for path in _scan_state_paths():
            try:
                data = path.read_bytes()
            except OSError as e:
                log.warning("backup.read_failed", path=str(path), error=str(e))
                failed += 1
                continue

            bandit_id = path.stem  # filename without .json
            key = f"{self._prefix}{bandit_id}.json"
            checksum = _sha256_hex(data)
            try:
                # boto3 is sync — push into a thread so we don't block
                # the event loop on network I/O. boto3's default retry
                # config (legacy mode, max 4 attempts) handles transient
                # 5xx for us.
                await loop.run_in_executor(
                    None,
                    lambda d=data, k=key: self._client.put_object(  # type: ignore[union-attr]
                        Bucket=self._bucket,
                        Key=k,
                        Body=d,
                        ContentType="application/json",
                        ServerSideEncryption="AES256",
                    ),
                )
                uploaded += 1
                manifest_entries.append({
                    "bandit_id": bandit_id,
                    "key": key,
                    "size_bytes": len(data),
                    "sha256": checksum,
                    "last_modified": datetime.fromtimestamp(
                        path.stat().st_mtime, tz=UTC
                    ).isoformat(),
                })
            except Exception as e:
                failed += 1
                log.warning(
                    "backup.put_failed",
                    bucket=self._bucket,
                    key=key,
                    error=str(e),
                )

        manifest = {
            "generated_at": datetime.now(UTC).isoformat(),
            "bucket": self._bucket,
            "prefix": self._prefix,
            "bandit_count": len(manifest_entries),
            "bandits": manifest_entries,
        }
        manifest_body = json.dumps(manifest, sort_keys=True, indent=2).encode("utf-8")
        manifest_key = f"{self._prefix}_manifest.json"
        try:
            await loop.run_in_executor(
                None,
                lambda: self._client.put_object(  # type: ignore[union-attr]
                    Bucket=self._bucket,
                    Key=manifest_key,
                    Body=manifest_body,
                    ContentType="application/json",
                    ServerSideEncryption="AES256",
                ),
            )
        except Exception as e:
            failed += 1
            log.warning(
                "backup.manifest_put_failed",
                bucket=self._bucket,
                key=manifest_key,
                error=str(e),
            )

        self._last_run_at = run_started
        self._last_run_uploaded = uploaded
        self._last_run_failed = failed
        self._total_uploads += uploaded
        self._total_failures += failed
        self._total_runs += 1
        log.info(
            "backup.run_complete",
            uploaded=uploaded,
            failed=failed,
            bucket=self._bucket,
            prefix=self._prefix,
        )


# Singleton — matches the consumer/producer pattern in this service.
# start() is a no-op until lifespan runs, so importing this module
# never touches the network or the filesystem.
state_backup = StateBackup()
