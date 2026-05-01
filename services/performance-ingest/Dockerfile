# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN pip install --no-cache-dir uv==0.5.4

COPY pyproject.toml ./
# Real backend image installs aiokafka so /ingest can emit
# content.metric_update events to Redpanda. tweepy/praw/asyncpg/numpy
# are still in `[runtime]` for the future poller + anomaly slices —
# pulling now is cheap (~20MB extra over aiokafka alone) and avoids a
# multi-stage build.
RUN uv pip install --system --no-cache '.[runtime]'

COPY . .

EXPOSE 8006

HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD python -c "import httpx; r=httpx.get('http://localhost:8006/health', timeout=3); raise SystemExit(0 if r.status_code==200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8006"]
