#!/usr/bin/env bash
set -euo pipefail

POST_URL="${1:-}"
COMMENT_TEXT="${2:-}"
PROFILE_URL="${3:-}"
WEBHOOK_URL="${4:-${N8N_WEBHOOK_URL:-}}"

if [[ -z "$POST_URL" || -z "$COMMENT_TEXT" ]]; then
  echo "Usage: $0 <postUrl> <commentText> [profileUrl] [webhookUrl]" >&2
  echo "Or set N8N_WEBHOOK_URL env var." >&2
  exit 2
fi

# Expect a running jlesage/chromium container named linkedin-login with CDP enabled.
CONTAINER_NAME="${CONTAINER_NAME:-linkedin-login}"
CDP_URL="${CDP_URL:-http://127.0.0.1:9222}"

# Folder that contains this script + JS helpers (mounted into the Playwright container).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="/work"

# Use Playwright *inside the linkedin-login network namespace* so it can reach CDP at 127.0.0.1:9222.
COORDS_JSON=$(sudo docker run --rm \
  --network "container:${CONTAINER_NAME}" \
  --shm-size=1g \
  -e CDP_URL="$CDP_URL" \
  -v "${SCRIPT_DIR}":"${WORKDIR}" \
  -w "${WORKDIR}" \
  mcr.microsoft.com/playwright:v1.41.2-jammy \
  bash -lc "\
    set -euo pipefail; \
    if [ ! -d node_modules/playwright ]; then \
      npm init -y >/dev/null 2>&1 || true; \
      npm i playwright@1.41.2 >/dev/null; \
    fi; \
    node linkedin_prepare_and_coords.js \"$POST_URL\" \"$COMMENT_TEXT\" \
  ")

echo "COORDS: $COORDS_JSON" >&2

# Extract numbers (prefer jq if available; else python)
extract() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$COORDS_JSON" | jq -r ".${key}"
  else
    python3 - <<PY
import json
j=json.loads('''$COORDS_JSON''')
print(j.get('$key'))
PY
  fi
}

CENTER_X=$(extract centerX)
CENTER_Y=$(extract centerY)
SCREEN_X=$(extract screenX)
SCREEN_Y=$(extract screenY)
UI_OFFSET=$(extract uiOffset)

ABS_X=$(python3 - <<PY
sx=float('$SCREEN_X'); cx=float('$CENTER_X');
print(int(round(sx+cx)))
PY
)
ABS_Y=$(python3 - <<PY
sy=float('$SCREEN_Y'); u=float('$UI_OFFSET'); cy=float('$CENTER_Y');
print(int(round(sy+u+cy)))
PY
)

echo "Attempting OS-level click at: $ABS_X,$ABS_Y (screenX=$SCREEN_X screenY=$SCREEN_Y uiOffset=$UI_OFFSET)" >&2

# OS-level click inside the chromium container (real X input).
sudo docker exec "$CONTAINER_NAME" sh -lc "
  set -e
  apk add --no-cache xdotool >/dev/null 2>&1 || true
  export DISPLAY=:0
  WIN=\"\$(xdotool search --onlyvisible --class chromium | head -n 1 || true)\"
  if [ -n \"\$WIN\" ]; then
    xdotool windowactivate --sync \"\$WIN\" || true
  fi
  xdotool mousemove $ABS_X $ABS_Y
  sleep 0.12
  xdotool click 1
  sleep 0.6
"

# Detect toast errors immediately after click (fail-fast evidence).
TOAST_JSON=$(sudo docker run --rm \
  --network "container:${CONTAINER_NAME}" \
  --shm-size=1g \
  -e CDP_URL="$CDP_URL" \
  -e TOAST_TIMEOUT_MS="6000" \
  -v "${SCRIPT_DIR}":"${WORKDIR}" \
  -w "${WORKDIR}" \
  mcr.microsoft.com/playwright:v1.41.2-jammy \
  bash -lc "\
    set -euo pipefail; \
    if [ ! -d node_modules/playwright ]; then \
      npm init -y >/dev/null 2>&1 || true; \
      npm i playwright@1.41.2 >/dev/null; \
    fi; \
    node linkedin_detect_toast_cdp.js \"$POST_URL\" \
  " 2>/dev/null || true)

echo "TOAST: $TOAST_JSON" >&2

# Post-click screenshot for verification.
HOST_SCREENSHOT_PATH="${SCRIPT_DIR}/linkedin_last.png"

sudo docker run --rm \
  --network "container:${CONTAINER_NAME}" \
  --shm-size=1g \
  -e CDP_URL="$CDP_URL" \
  -e SCREENSHOT_PATH="$WORKDIR/linkedin_last.png" \
  -v "${SCRIPT_DIR}":"${WORKDIR}" \
  -w "${WORKDIR}" \
  mcr.microsoft.com/playwright:v1.41.2-jammy \
  bash -lc "\
    set -euo pipefail; \
    if [ ! -d node_modules/playwright ]; then \
      npm init -y >/dev/null 2>&1 || true; \
      npm i playwright@1.41.2 >/dev/null; \
    fi; \
    node linkedin_screenshot_cdp.js \
  "

echo "Done. Screenshot: ${HOST_SCREENSHOT_PATH}" >&2

# Optional: attempt connection request on a profile after commenting.
CONNECT_JSON=''
if [[ -n "${PROFILE_URL:-}" ]]; then
  CONNECT_JSON=$(sudo docker run --rm \
    --network "container:${CONTAINER_NAME}" \
    --shm-size=1g \
    -e CDP_URL="$CDP_URL" \
    -v "${SCRIPT_DIR}":"${WORKDIR}" \
    -w "${WORKDIR}" \
    mcr.microsoft.com/playwright:v1.41.2-jammy \
    bash -lc "\
      set -euo pipefail; \
      if [ ! -d node_modules/playwright ]; then \
        npm init -y >/dev/null 2>&1 || true; \
        npm i playwright@1.41.2 >/dev/null; \
      fi; \
      node linkedin_connect_if_needed_cdp.js \"$PROFILE_URL\" \
    " 2>/dev/null || true)
  echo "CONNECT: $CONNECT_JSON" >&2
fi

# Optional: webhook callback (best-effort)
if [[ -n "${WEBHOOK_URL:-}" ]]; then
  SCREENSHOT_PATH="${HOST_SCREENSHOT_PATH}"
  SCREENSHOT_BYTES=""
  SCREENSHOT_SHA256=""
  if [[ -f "${SCREENSHOT_PATH}" ]]; then
    SCREENSHOT_BYTES=$(stat -c "%s" "${SCREENSHOT_PATH}" 2>/dev/null || wc -c <"${SCREENSHOT_PATH}" 2>/dev/null || true)
    SCREENSHOT_SHA256=$(sha256sum "${SCREENSHOT_PATH}" 2>/dev/null | awk '{print $1}' || true)
  fi

  if [[ "${SKIP_VERIFY:-}" == "1" ]]; then
    VERIFY_JSON='{"ok":false,"skipped":true}'
  else
    VERIFY_JSON=$(sudo docker run --rm \
      --network "container:${CONTAINER_NAME}" \
      --shm-size=1g \
      -e CDP_URL="$CDP_URL" \
      -e VERIFY_TIMEOUT_MS="60000" \
      -e VERIFY_POLL_MS="2000" \
      -v "${SCRIPT_DIR}":"${WORKDIR}" \
      -w "${WORKDIR}" \
      mcr.microsoft.com/playwright:v1.41.2-jammy \
      bash -lc "
        set -euo pipefail;
        if [ ! -d node_modules/playwright ]; then
          npm init -y >/dev/null 2>&1 || true;
          npm i playwright@1.41.2 >/dev/null;
        fi;
        node linkedin_verify_comment_cdp.js \"$POST_URL\" \"$COMMENT_TEXT\"
      " 2>/dev/null || true)
  fi

  POST_URL="$POST_URL" COMMENT_TEXT="$COMMENT_TEXT" PROFILE_URL="$PROFILE_URL" COORDS_JSON="$COORDS_JSON" VERIFY_JSON="$VERIFY_JSON" TOAST_JSON="$TOAST_JSON" CONNECT_JSON="$CONNECT_JSON" \
  SCREENSHOT_PATH="$SCREENSHOT_PATH" SCREENSHOT_BYTES="$SCREENSHOT_BYTES" SCREENSHOT_SHA256="$SCREENSHOT_SHA256" \
  python3 - <<'PY' | curl -sS -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true
import json, os, time
payload = {
  "event": "linkedin_comment_and_connect",
  "ts": int(time.time()),
  "postUrl": os.environ.get("POST_URL"),
  "commentText": os.environ.get("COMMENT_TEXT"),
  "profileUrl": os.environ.get("PROFILE_URL") or "",
  "clickAttempted": True,
  "status": "unknown",
  "coords": None,
  "verify": None,
  "toast": None,
  "connect": None,
  "connectionSent": False,
  "screenshotPath": os.environ.get("SCREENSHOT_PATH") or "",
  "screenshotBytes": int(os.environ.get("SCREENSHOT_BYTES") or 0),
  "screenshotSha256": os.environ.get("SCREENSHOT_SHA256") or "",
}
coords_json = os.environ.get("COORDS_JSON")
if coords_json:
  try: payload["coords"] = json.loads(coords_json)
  except: payload["coords"] = coords_json
verify_json = os.environ.get("VERIFY_JSON")
if verify_json:
  try: payload["verify"] = json.loads(verify_json)
  except: payload["verify"] = verify_json

toast_json = os.environ.get("TOAST_JSON")
if toast_json:
  try: payload["toast"] = json.loads(toast_json)
  except: payload["toast"] = toast_json

connect_json = os.environ.get("CONNECT_JSON")
if connect_json:
  try: payload["connect"] = json.loads(connect_json)
  except: payload["connect"] = connect_json

if isinstance(payload.get("connect"), dict):
  payload["connectionSent"] = bool(payload["connect"].get("connectionSent"))

v = payload.get("verify") or {}
ok = bool(v.get("ok")) if isinstance(v, dict) else False
payload["status"] = "ok" if ok else "fail"

print(json.dumps(payload))
PY
fi
