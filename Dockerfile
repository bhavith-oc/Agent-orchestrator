# Aether Orchestrator — Multi-stage Docker build
# Stage 1: Build the React UI
# Stage 2: Run the FastAPI backend + serve built UI

# ── Stage 1: Build UI ──────────────────────────────────────────────
FROM node:22-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# ── Stage 2: Python API + built UI ─────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy API source
COPY api/ ./api/

# Copy built UI into a static directory the API can serve
COPY --from=ui-builder /app/ui/dist ./ui/dist

# Environment defaults
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

# Run the FastAPI server
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
WORKDIR /app/api
