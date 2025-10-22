FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
    build-essential curl bash ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Use whichever you actually have (pyproject + pip, or requirements.txt)
COPY requirements.txt /app/requirements.txt
RUN [ -s /app/requirements.txt ] && pip install --no-cache-dir -r /app/requirements.txt || true

COPY app /app/app
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

RUN mkdir -p /app/logs /app/data /app/uploads /app/generated

EXPOSE 5294
CMD ["/bin/bash", "-lc", "/app/start.sh"]
