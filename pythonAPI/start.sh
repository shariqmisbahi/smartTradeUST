#!/usr/bin/env bash
set -e

# Load env file without modifying the bind mount (handles CRLF)
if [ -f /app/env.txt ]; then
  CLEAN="/tmp/env.cleaned"
  awk '{ sub(/\r$/, ""); print }' /app/env.txt > "$CLEAN"
  set -a
  . "$CLEAN"
  set +a
fi

# Default port (you said API is 5294)
: "${PORT:=5294}"

mkdir -p /app/data /app/logs /app/uploads /app/generated

echo "=== Starting tradeAPI Backend ==="
echo "Timestamp: $(date)"
echo "APP_NAME=${APP_NAME:-tradeAPI} | PORT=${PORT}"
echo "CORS_ORIGINS=${CORS_ORIGINS}"

# Start FastAPI via Uvicorn; remove --reload for prod if you like
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload
