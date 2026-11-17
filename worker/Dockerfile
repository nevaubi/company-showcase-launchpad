# Always-on IR pipeline worker (Render Background Worker). Runs the deep build loop from this repo's
# scripts; all progress lives in the database, so a restart or redeploy resumes where it stopped.
FROM oven/bun:1.2-debian
RUN apt-get update && apt-get install -y --no-install-recommends \
      procps poppler-utils tesseract-ocr imagemagick libreoffice-calc python3 python3-venv ca-certificates git \
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
# Reader/converter counts and child heap sizes are derived at start from the container's real memory
# limit (cgroup), so a plan change never leaves the worker over- or under-sized. Override with IR_LANES
# or IR_*_FIXED only when needed.
ENV NODE_OPTIONS=--max-old-space-size=2048
