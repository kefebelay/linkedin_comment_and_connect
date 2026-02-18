# linkedin_comment_and_connect (OpenClaw plugin)

Provides an OpenClaw tool:

- `linkedin_comment_and_connect`

It comments on a LinkedIn post via a hybrid **CDP + OS-level click** strategy (Playwright for navigation/typing, `xdotool` for the final submit click), then optionally visits a profile URL and sends a connection request when available.

## What it does

1) Comment on a LinkedIn post (`postUrl`)
2) (Optional) Visit a LinkedIn profile (`profileUrl`) and click **Connect**
   - If Connect is under the overflow **More / ...** menu, it will open the menu and click Connect there
   - If `profileUrl` contains `/company/`, it skips the connect step
   - Connect success is confirmed by the UI showing **Pending**

## Prerequisites

### 1) A logged-in LinkedIn browser container

This plugin expects a running **jlesage/chromium** container (or equivalent) that is:
- already logged in to LinkedIn
- exposing **CDP** (Chrome DevTools Protocol)
- reachable at `http://127.0.0.1:9222` *from within its own network namespace*

By default it targets:
- container name: `linkedin-login`
- CDP URL: `http://127.0.0.1:9222`

You can override with env vars:
- `CONTAINER_NAME`
- `CDP_URL`

### 2) Docker + sudo

The runner script uses `sudo docker run` and `sudo docker exec`.

Requirements:
- Docker installed and running
- The OpenClaw user can run docker with sudo (or adjust the script to your environment)

### 3) X/Display inside the browser container

The submit click uses `xdotool` inside the browser container, targeting `DISPLAY=:0`.
The script will `apk add xdotool` inside the container if needed.

## Install (from GitHub)

```bash
npm i -g github:<YOUR_GITHUB_USER>/linkedin_comment_and_connect

(Use tags/releases once you publish them.)
Configure OpenClaw

Add to your OpenClaw config plugins list (example):

{
  "plugins": [
    {
      "name": "linkedin_comment_and_connect"
    }
  ]
}

Plugin config (optional):

    scriptPath (default ./skills/linkedin-comment-connect/scripts/run_linkedin_comment_connect_hybrid.sh)
    defaultWebhookUrl
    timeoutSec

Tool usage
Tool call (JSON)

{
  "postUrl": "https://www.linkedin.com/posts/<...>",
  "commentText": "Loved this — thanks for sharing.",
  "profileUrl": "https://www.linkedin.com/in/someone",
  "webhookUrl": "https://your-webhook-endpoint.example.com",
  "async": true,
  "jobId": "optional-external-id-123"
}

Notes:

    profileUrl is optional. If omitted, it will only comment.
    If profileUrl contains /company/, connect is skipped (reason: "skipped_company_url").
    async defaults to true.

Immediate tool response

With async: true (default), the tool returns immediately:

{
  "ok": true,
  "accepted": true,
  "async": true,
  "jobId": "optional-external-id-123",
  "pid": 12345,
  "logPath": "/tmp/openclaw/linkedin_comment_and_connect_optional-external-id-123.log",
  "webhookUrl": "https://your-webhook-endpoint.example.com"
}

With async: false, it returns stdout / stderr from the runner script.
Webhook callback

If webhookUrl is provided (or env N8N_WEBHOOK_URL is set), the runner script POSTs JSON to your webhook.
Webhook payload (example)

{
  "event": "linkedin_comment_and_connect",
  "ts": 1739870000,
  "postUrl": "https://www.linkedin.com/posts/<...>",
  "commentText": "Loved this — thanks for sharing.",
  "profileUrl": "https://www.linkedin.com/in/someone",
  "clickAttempted": true,
  "status": "ok",
  "coords": {
    "centerX": 512.3,
    "centerY": 812.7,
    "screenX": 0,
    "screenY": 0,
    "uiOffset": 80
  },
  "verify": {
    "ok": true
  },
  "toast": {
    "ok": true
  },
  "connect": {
    "ok": true,
    "profileUrl": "https://www.linkedin.com/in/someone",
    "connectionSent": true,
    "reason": "pending_confirmed"
  },
  "connectionSent": true,
  "screenshotPath": ".../linkedin_last.png",
  "screenshotBytes": 123456,
  "screenshotSha256": "abc123..."
}

Fields to rely on

    status: "ok" means comment verification succeeded; "fail" means comment verification failed.
    connectionSent: boolean; true only when the UI confirms Pending after connecting.
    connect.reason: why it did/didn’t connect. Common values:
        pending_confirmed (success)
        skipped_company_url
        follow_only_no_connect
        already_connected_or_pending
        connect_not_available
        no_pending_confirmation

Notes

See skills/linkedin-comment-connect/SKILL.md.
```