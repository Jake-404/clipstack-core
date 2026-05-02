# Bandit state restore from S3

Tier-2 procedure. RPO 1 hr / RTO 4 hr per [README.md](./README.md). The bandit-orchestrator's filesystem state at `BANDIT_DATA_DIR/{bandit_id}.json` is everything a workspace's Thompson sampler has learned: registered arms, Beta(α, β) posteriors, allocation counts, reward history. The canonical backup procedure ships in [`services/bandit-orchestrator/BACKUP.md`](../../services/bandit-orchestrator/BACKUP.md) — this document is the restore-side counterpart.

The orchestrator restarts cleanly even with no state — it rescans `BANDIT_DATA_DIR` and rebuilds the in-memory reverse index on lifespan startup (`main.py`). With no state, every bandit is back to its uniform `Beta(1, 1)` priors and weeks of observation are gone. Hence: enable backup before the first production workspace.

## Failure modes

### F1 — Container filesystem wiped

**Cause.** Orchestrator restart on a stateless platform that doesn't persist `BANDIT_DATA_DIR` across deploys, container eviction without volume migration, or a node failure on a non-replicated volume.

**Detection.** `GET /backup/status` reports recent successful uploads but the state files are absent on the new container; `GET /bandits?company_id=<known>` returns an empty list for a workspace that previously had bandits; allocations land at the seeded prior rather than the learned posterior.

**Action.** Restore from S3 per the procedure below.

### F2 — Manual `rm -rf` mishap

**Cause.** Operator intent was a different directory; tab-completion went sideways.

**Detection.** Same as F1, but with a guilty operator.

**Action.** Restore from S3 per the procedure below. The backup interval defaults to 5 minutes, so RPO is bounded at 5 minutes for this case (better than the Tier-2 1-hr target).

### F3 — Storage volume corruption

**Cause.** Underlying disk failure, filesystem corruption, partial-write during a power event.

**Detection.** Some `*.json` files in `BANDIT_DATA_DIR` deserialise; others raise `JSONDecodeError` on lifespan rescan; the orchestrator boots into a half-intact state.

**Action.** Treat as a full restore. Wipe `BANDIT_DATA_DIR`, restore everything from the most recent manifest. A partial restore that mixes corrupt local state with clean S3 state is harder to reason about than a full restore.

## Procedure (assumes `BANDIT_BACKUP_ENABLED=true`)

This is the canonical 5-step restore. The variables `$BUCKET` and `$PREFIX` come from `BANDIT_BACKUP_S3_BUCKET` and `BANDIT_BACKUP_S3_PREFIX` (default `bandits/`).

### Step 1 — Stop the bandit-orchestrator service

Drain traffic via the load balancer or platform health probe. The orchestrator's `/allocate` and `/reward` endpoints are idempotent and the publish_pipeline degrades gracefully — `bandit_allocate` returns `{}` partial state when the orchestrator is unreachable, so the publish path proceeds without `bandit_variant_id` (per `core/docs/closed-loop.md` § Fail-soft semantics). Idempotent calls during the drain land in the bus's at-least-once retry path; nothing is lost.

```bash
# Kubernetes
kubectl scale deployment bandit-orchestrator --replicas=0

# Docker Compose
docker compose stop bandit-orchestrator

# Railway / Fly / Render
# Use the platform's stop / pause-deployment toggle in the dashboard.
```

### Step 2 — Pull the manifest and state files from S3

From a workstation with AWS credentials configured (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).

```bash
mkdir -p /tmp/bandits
aws s3 cp "s3://$BUCKET/$PREFIX/_manifest.json" /tmp/bandits/_manifest.json

# Pull every state file referenced in the manifest.
aws s3 cp "s3://$BUCKET/$PREFIX/_manifest.json" - \
  | jq -r '.bandits[] | .bandit_id' \
  | xargs -I{} aws s3 cp "s3://$BUCKET/$PREFIX/{}.json" /tmp/bandits/
```

For non-AWS providers the equivalent CLIs are `mc cp` (MinIO), `rclone copyto`, or whatever your provider ships. Set `BANDIT_BACKUP_S3_ENDPOINT_URL` consistently between the running service and the restore-side tooling.

### Step 3 — Verify integrity

The manifest carries a `sha256` for every file. Verify before staging:

```bash
jq -r '.bandits[] | "\(.sha256)  /tmp/bandits/\(.bandit_id).json"' \
  /tmp/bandits/_manifest.json | sha256sum -c -
```

Every line should print `OK`. A `FAILED` line means the file was corrupted in transit or at rest in S3 — pull that file fresh, re-verify. If repeated pulls fail, the S3 object is corrupt; fall through to the seeded-prior reset path documented in § No backup configured.

### Step 4 — Stage files into the running pod

The path inside the orchestrator container is `BANDIT_DATA_DIR` (default `/data/bandits`). The orchestrator's lifespan rescans this directory on startup and rebuilds the reverse index automatically.

```bash
# Kubernetes
kubectl cp /tmp/bandits/ orchestrator-pod:/data/bandits/

# Docker Compose (volume mount)
cp /tmp/bandits/*.json /var/lib/docker/volumes/<project>_bandit_data/_data/

# Railway / Fly volumes
# Use the platform's volume-attach + scp / volume-mount workflow.
```

Do not copy `_manifest.json` into `BANDIT_DATA_DIR` — the orchestrator only reads `*.json` files matching the `{bandit_id}.json` pattern; the manifest's name is fine but it's noise on the live volume.

### Step 5 — Restart the orchestrator

```bash
# Kubernetes
kubectl scale deployment bandit-orchestrator --replicas=1

# Docker Compose
docker compose start bandit-orchestrator
```

The lifespan rescans `BANDIT_DATA_DIR/*.json`, rebuilds the in-memory reverse index, and the consumer subscribes to `content.metric_update` (per `consumer.py`). The first message it handles has a fully-restored attribution path.

### Step 6 — Verify

```bash
# Liveness.
curl http://orchestrator:8008/health

# A known workspace's bandits should reappear.
curl "http://orchestrator:8008/bandits?company_id=<known-company-id>"

# Backup status should resume reporting successful uploads on its next interval.
curl http://orchestrator:8008/backup/status
```

The first allocation for any workspace should reflect the restored posterior (winning variants get higher arm scores), not a uniform prior. If allocations look like uniform draws, the state files are present but the orchestrator is not reading them — check container logs for the lifespan rescan output and confirm `BANDIT_DATA_DIR` is set correctly.

## Drift since backup

The backup interval is 5 minutes by default (`BANDIT_BACKUP_INTERVAL_SECONDS`). Any rewards or allocations that landed AFTER the most recent backup snapshot are LOST in the state file.

- The bandit consumer's at-least-once delivery (manual offset commit on Redpanda) means any unconsumed `content.metric_update` events will be re-delivered when the orchestrator restarts. These will be re-attributed correctly once the consumer catches up.
- Events that were consumed and applied before the snapshot are NOT reprocessed (the offset advanced; Redpanda won't replay them). The reward signal from those events is the single point of permanent loss.

This is acceptable per the Tier-2 RPO of 1 hour. With the default 5-minute interval the actual RPO is closer to 5 minutes; lengthening the interval (`BANDIT_BACKUP_INTERVAL_SECONDS=1800`) cuts the PUT count by 6× at the cost of up to 30 minutes of recoverable state loss on a hard restart, which is still within Tier-2.

## No backup configured (`BANDIT_BACKUP_ENABLED=false`)

When the backup module is disabled — either by config or because the orchestrator's `[runtime]` extra wasn't installed and `boto3` is missing — there is no S3 state to restore from. On a filesystem wipe the orchestrator boots clean with zero learned state.

Recovery semantics:

- All posteriors fully reset to seeded priors per `_initial_arms` (uniform `Beta(1, 1)` until `register_bandit` runs again).
- The Strategist's next campaign cycle re-registers any bandit whose ID does not match an existing entry — newly-registered bandits start fresh, but the campaign continues to publish.
- Existing campaigns whose bandit IDs are in flight lose their experiment state. The next `/allocate` call returns a uniform draw; subsequent rewards rebuild the posterior from scratch.

**Mitigation.** Enable the backup before the first production workspace. The cost estimate at typical scale is ~$5/month at 100 bandits (per `BACKUP.md` § Cost estimate); at single-workspace scale it's effectively free. Set:

```bash
BANDIT_BACKUP_ENABLED=true
BANDIT_BACKUP_S3_BUCKET=clipstack-bandit-backup-<env>
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
AWS_REGION=<region>
```

For non-AWS providers, additionally set `BANDIT_BACKUP_S3_ENDPOINT_URL` per the `BACKUP.md` § S3-compatible providers matrix.
