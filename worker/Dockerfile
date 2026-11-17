# Always-on IR pipeline worker (Render Background Worker). Runs the deep build loop from this repo's
# scripts; all progress lives in the database, so a restart or redeploy resumes where it stopped.
FROM oven/bun:1.2-debian
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils tesseract-ocr imagemagick libreoffice-calc python3 python3-venv ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/dvenv && /opt/dvenv/bin/pip install --no-cache-dir docling
WORKDIR /app
COPY package.json bun.lock* bun.lockb* ./
RUN bun install --frozen-lockfile || bun install
COPY . .
ENV IR_WORK_DIR=/var/data/ir
ENV DOCLING_PYTHON=/opt/dvenv/bin/python
ENV IR_WAIT_LEASE=1
CMD ["bun", "scripts/ir-deep-loop.ts", "--python=/opt/dvenv/bin/python"]
# Sized for the 32 GB / 8 CPU worker plan (4 GB OOM-killed at the old defaults); lower these on a smaller plan.
ENV IR_DOCLING_WORKERS=6 IR_DOCLING_THREADS=4 IR_EXTRACT_CONCURRENCY=24 IR_VISION_CONCURRENCY=10 NODE_OPTIONS=--max-old-space-size=8192
