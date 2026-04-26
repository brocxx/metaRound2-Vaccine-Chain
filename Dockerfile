# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Stage 1: build the Next.js mission-control bundle as static HTML + JS.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS frontend
WORKDIR /fe

ARG NEXT_PUBLIC_ENV_BASE_URL=""
ARG NEXT_PUBLIC_USE_LIVE="1"
ENV NEXT_PUBLIC_ENV_BASE_URL=$NEXT_PUBLIC_ENV_BASE_URL
ENV NEXT_PUBLIC_USE_LIVE=$NEXT_PUBLIC_USE_LIVE

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --progress=false --loglevel=info

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Python runtime serving FastAPI + the Next.js static export.
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/tmp/hf \
    ENABLE_WEB_INTERFACE=true \
    STATIC_FRONTEND_DIR=/app/static_frontend \
    ALLOWED_ORIGINS="*"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY models.py openenv.yaml ./
COPY geo_config.json ./
COPY server/ ./server/
COPY client.py validate_submission.py ./
COPY README.md ./

COPY --from=frontend /fe/out ./static_frontend

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:7860/health').getcode()==200 else 1)" || exit 1

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
