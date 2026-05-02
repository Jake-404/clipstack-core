# Bandit state — periodic S3 backup

## Why this exists

Bandit state lives at `BANDIT_DATA_DIR/{bandit_id}.json` (default
`/data/bandits`) on the orchestrator container. That's everything a
workspace's Thompson sampler has learned: registered arms, Beta(α, β)
posteriors, allocation counts, reward history, prune flags.

Filesystem-only persistence is lossy. A container restart that loses
the volume — node failure, ungraceful eviction, infra rebuild — wipes
every workspace's bandit memory. The orchestrator restarts cleanly
(it rescans `BANDIT_DATA_DIR` on startup and rebuilds the reverse
index) but every bandit is back to its uniform `Beta(1, 1)` priors
and weeks of observation are gone.

This module ships an opt-in periodic upload of every state file to an
S3-compatible bucket. Restoring before service start is a 5-line
shell loop driven by a manifest the backup writes alongside the
state files.

## Configuration matrix

All env vars. Backup is **disabled by default** — set
`BANDIT_BACKUP_ENABLED=true` to turn it on.

| Variable | Default | Required | Notes |
|---|---|---|---|
| `BANDIT_BACKUP_ENABLED` | `false` | — | Master switch. `false` makes `start()` a no-op. |
| `BANDIT_BACKUP_S3_BUCKET` | — | yes (when enabled) | The bucket to upload to. |
| `BANDIT_BACKUP_S3_PREFIX` | `bandits/` | no | Folder/prefix under the bucket. Trailing slash optional. |
| `BANDIT_BACKUP_INTERVAL_SECONDS` | `300` | no | How often to run a backup pass. Default 5 min. |
| `BANDIT_BACKUP_S3_ENDPOINT_URL` | — | no | Override for non-AWS providers (R2, MinIO, Wasabi). |
| `AWS_REGION` | — | no | Standard boto3 env. |
| `AWS_ACCESS_KEY_ID` | — | yes (when enabled) | Standard boto3 env. boto3 reads this directly. |
| `AWS_SECRET_ACCESS_KEY` | — | yes (when enabled) | Standard boto3 env. boto3 reads this directly. |

The `BANDIT_DATA_DIR` env var is read fresh each pass — the backup
honours whatever the orchestrator itself is using. No duplicate
configuration.

Operator visibility lives at `GET /backup/status`. The shape mirrors
`/consumer/status`:

```json
{
  "enabled": true,
  "bucket": "clipstack-bandit-backup",
  "prefix": "bandits/",
  "interval_seconds": 300,
  "last_run_at": "2026-05-02T10:32:01.193+00:00",
  "last_run_uploaded_count": 14,
  "last_run_failed_count": 0,
  "total_uploads": 8064,
  "total_failures": 2,
  "total_runs": 576
}
```

## What the backup writes

Every interval, for each `*.json` file in `BANDIT_DATA_DIR`:

- Object: `s3://<bucket>/<prefix>/<bandit_id>.json`
- Content-Type: `application/json`
- Server-side encryption: `AES256` (set on every put)

Plus one manifest per pass:

- Object: `s3://<bucket>/<prefix>/_manifest.json`
- Body:
  ```json
  {
    "generated_at": "2026-05-02T10:32:01.193+00:00",
    "bucket": "clipstack-bandit-backup",
    "prefix": "bandits/",
    "bandit_count": 14,
    "bandits": [
      {
        "bandit_id": "bandit_a1b2c3d4e5f6",
        "key": "bandits/bandit_a1b2c3d4e5f6.json",
        "size_bytes": 4831,
        "sha256": "<hex>",
        "last_modified": "2026-05-02T10:31:58.041+00:00"
      },
      ...
    ]
  }
  ```

The manifest is the index — restore reads it first, then iterates the
`bandits[]` array to pull every state file with its sha256 for
integrity verification.

A failed put is logged + counted but doesn't crash the loop; the
manifest is written last so a partially-failed run still leaves an
honest accounting of what made it up.

## Restore procedure

Before starting the orchestrator on a fresh volume:

```bash
# 1. Pull the manifest.
aws s3 cp s3://$BUCKET/$PREFIX/_manifest.json - > /tmp/manifest.json

# 2. Iterate every bandit_id in the manifest and download into
#    BANDIT_DATA_DIR. The orchestrator's lifespan rescans this
#    directory on startup and rebuilds the draft_id reverse index
#    automatically — no other restoration step needed.
mkdir -p "$BANDIT_DATA_DIR"
jq -r '.bandits[].key' /tmp/manifest.json | while read -r key; do
  aws s3 cp "s3://$BUCKET/$key" "$BANDIT_DATA_DIR/$(basename "$key")"
done

# 3. (Optional) Verify integrity against the manifest.
jq -r '.bandits[] | "\(.sha256)  '"$BANDIT_DATA_DIR"'/\(.bandit_id).json"' \
  /tmp/manifest.json | sha256sum -c -

# 4. Start the service. main.py's lifespan rescans BANDIT_DATA_DIR
#    and the draft_id → (bandit_id, variant_id) index is rebuilt
#    before the consumer starts, so the first message handled has a
#    fully-restored attribution path.
```

For non-AWS providers, swap `aws s3` for the provider's CLI
(`mc cp` for MinIO, `rclone copyto` for any of them) and point at
the same endpoint URL the service uses.

## S3-compatible providers

Tested or expected to work without code changes:

| Provider | Endpoint URL pattern | Notes |
|---|---|---|
| **AWS S3** | (default) | No `BANDIT_BACKUP_S3_ENDPOINT_URL` needed. Set `AWS_REGION`. |
| **Cloudflare R2** | `https://<account>.r2.cloudflarestorage.com` | Set `AWS_REGION=auto`. R2 ignores SSE but accepts the header. |
| **MinIO** | `http://minio:9000` (or your endpoint) | For self-hosted dev/test stacks. |
| **Wasabi** | `https://s3.<region>.wasabisys.com` | Set `AWS_REGION` to match the endpoint. |

boto3's default retry config (legacy mode, max 4 attempts) handles
transient 5xx for all of them; a put that exhausts retries is logged
+ counted and the next interval gets another shot.

## Cost estimate

Back-of-envelope at typical scale:

- N bandits per workspace × ~5 KB per state file
- 1 upload per `BANDIT_BACKUP_INTERVAL_SECONDS` (default 300s = 5 min)
- = 12 puts/hour/bandit × 24 hours = **288 puts/day/bandit** + 288
  manifest puts/day (one shared manifest per pass, not per bandit)

At AWS S3 standard pricing (~$0.005 per 1k PUT, ~$0.023 per GB-month
storage):

- 100 bandits → 28,800 puts/day → ~$0.14/day in PUT charges
- 100 bandits × 5 KB × 30 days × 1 version = ~15 MB-month → < $0.01
  in storage

**~$5/month total at 100 bandits.** Negligible until well into the
thousands. Cloudflare R2 is roughly free at this scale (no egress
charges, generous free PUT tier).

If you need to dial cost down at very high bandit counts, lengthen
`BANDIT_BACKUP_INTERVAL_SECONDS` — every 30 minutes (1800) cuts the
PUT count by 6× with at most 30 minutes of recoverable state loss
on a hard restart.

## Failure semantics

The backup is **fail-soft**: nothing it does can break the
orchestrator's main work.

- `boto3` not installed (the `[runtime]` extra wasn't installed) →
  warn-log and degrade to disabled. Match: `aiokafka` graceful
  degradation in `consumer.py` / `producer.py`.
- `BANDIT_BACKUP_ENABLED=false` (default) → `start()` is a no-op,
  `is_enabled` returns False, `/backup/status` reports `enabled=False`.
- S3 unreachable / bucket missing / put 4xx → log + count, keep
  ticking. The next pass tries every state file fresh; a transient
  outage costs you one interval of recoverability.
- `stop()` runs a final flush before tearing down so a graceful
  shutdown isn't lossy.

The backup never raises. The orchestrator's `/allocate` and `/reward`
paths are never blocked by it.
