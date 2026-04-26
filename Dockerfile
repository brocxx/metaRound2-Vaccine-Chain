# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Stage 1: build the Next.js mission-control bundle as static HTML + JS.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /fe

ARG NEXT_PUBLIC_ENV_BASE_URL=""
ARG NEXT_PUBLIC_USE_LIVE="1"
ENV NEXT_PUBLIC_ENV_BASE_URL=$NEXT_PUBLIC_ENV_BASE_URL
ENV NEXT_PUBLIC_USE_LIVE=$NEXT_PUBLIC_USE_LIVE

COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

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

# region agent log
RUN python - <<'PY'
import json
import platform
import subprocess
import time
from pathlib import Path

entry = {
    "sessionId": "9e78a5",
    "runId": "pre-fix-build-debug",
    "hypothesisId": "H1_H2_H3",
    "location": "Dockerfile:34",
    "message": "pre-pip environment snapshot",
    "data": {
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "pip_version": subprocess.check_output(["python", "-m", "pip", "--version"], text=True).strip(),
        "requirements_txt": Path("requirements.txt").read_text(encoding="utf-8", errors="replace"),
    },
    "timestamp": int(time.time() * 1000),
}
Path("debug-9e78a5.log").write_text(json.dumps(entry) + "\n", encoding="utf-8")
print(json.dumps(entry))
PY
# endregion

# region agent log
RUN pip install --no-cache-dir -r requirements.txt > /tmp/pip-install.log 2>&1 || ( \
    python - <<'PY' \
import json \
import time \
from pathlib import Path \
tail = Path('/tmp/pip-install.log').read_text(encoding='utf-8', errors='replace').splitlines()[-120:] \
entry = { \
    'sessionId': '9e78a5', \
    'runId': 'pre-fix-build-debug', \
    'hypothesisId': 'H1_H2_H3', \
    'location': 'Dockerfile:58', \
    'message': 'pip install failed with tail', \
    'data': {'pip_log_tail': tail}, \
    'timestamp': int(time.time() * 1000), \
} \
with Path('debug-9e78a5.log').open('a', encoding='utf-8') as f: \
    f.write(json.dumps(entry) + '\n') \
print(json.dumps(entry)) \
PY \
    ; echo "---- pip install failure tail ----" \
    ; tail -n 120 /tmp/pip-install.log \
    ; exit 1 \
)
# endregion

COPY models.py openenv.yaml ./
COPY server/ ./server/
COPY client.py validate_submission.py ./
COPY README.md ./

# region agent log
RUN python - <<'PY'
import json
import time
from pathlib import Path

entry = {
    "sessionId": "9e78a5",
    "runId": "pre-fix-build-debug",
    "hypothesisId": "H4",
    "location": "Dockerfile:95",
    "message": "post-copy app tree snapshot",
    "data": {
        "has_client_py": Path("client.py").exists(),
        "has_validate_submission_py": Path("validate_submission.py").exists(),
        "server_files": sorted([str(p) for p in Path("server").glob("*")])[:20],
    },
    "timestamp": int(time.time() * 1000),
}
with Path("debug-9e78a5.log").open("a", encoding="utf-8") as f:
    f.write(json.dumps(entry) + "\n")
print(json.dumps(entry))
PY
# endregion

COPY --from=frontend /fe/out ./static_frontend

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:7860/health').getcode()==200 else 1)" || exit 1

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "7860"]
