# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN pip install --no-cache-dir uv==0.5.4

COPY pyproject.toml ./
# Real backend image — install the `[ml]` extra so LightGBM + numpy are
# available at /predict and /train time. The CI lint matrix installs only
# `[dev]` so ruff stays fast (heavy ML deps are skipped there). Image
# size: ~400MB on top of python:3.11-slim, which is the right call once
# real workspaces have enough samples to train.
RUN uv pip install --system --no-cache '.[ml]'

COPY . .

EXPOSE 8007

HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD python -c "import httpx; r=httpx.get('http://localhost:8007/health', timeout=3); raise SystemExit(0 if r.status_code==200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8007"]
