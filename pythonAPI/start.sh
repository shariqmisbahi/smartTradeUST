#!/usr/bin/env bash
set -e

# Load env values (supports CRLF without editing the mounted file)
if [ -f /app/env.txt ]; then
  CLEAN="/tmp/env.cleaned"
  # strip trailing CRs from each line and write to a temp file
  awk '{ sub(/\r$/, ""); print }' /app/env.txt > "$CLEAN"
  set -a
  . "$CLEAN"
  set +a
fi

# Default API port (you said you switched back to 5294)
: "${PORT:=5294}"

mkdir -p /app/data /app/logs /app/uploads /app/generated

echo "=== Starting tradeAPI Backend ==="
echo "Timestamp: $(date)"
echo "APP_NAME=${APP_NAME:-tradeAPI Backend} | PORT=${PORT}"
echo "CORS_ORIGINS=${CORS_ORIGINS}"

# Start FastAPI (remove --reload for pure prod)
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload