# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN pip install --no-cache-dir uv==0.5.4

COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

# Presidio's spaCy model download lands here in A.2:
#   RUN python -m spacy download en_core_web_lg
# A.1 stub mode skips it.

COPY . .

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=5s --retries=10 \
  CMD python -c "import httpx; r=httpx.get('http://localhost:8003/health', timeout=3); raise SystemExit(0 if r.status_code==200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
