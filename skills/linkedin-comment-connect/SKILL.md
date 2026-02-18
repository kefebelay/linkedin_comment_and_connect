---
name: linkedin-comment-connect
description: >-
  Comment on a LinkedIn post using a logged-in noVNC Chromium via CDP + OS-level xdotool click,
  then optionally visit a profile URL and send a connection request if available.
---

# LinkedIn comment + connect (hybrid CDP + xdotool)

## What it does

1) Opens a LinkedIn post URL and posts a comment using a hybrid strategy:
   - Playwright over CDP to navigate + type
   - OS-level `xdotool` click to press the BLUE submit button reliably
2) Optionally visits a LinkedIn **profile URL** and attempts to send a **Connect** request.
   - Skips `.../company/...` URLs
   - Uses overflow **More / ...** menu when Connect is not visible on load
   - Success is confirmed by seeing **Pending**

## Tool

This is exposed as an OpenClaw tool named:

- `linkedin_comment_and_connect`

Parameters:
- `postUrl` (required)
- `commentText` (required)
- `profileUrl` (optional)
- `webhookUrl` (optional)
- `async` (optional, default true)

## Runtime assumptions

- You have a running logged-in jlesage/chromium container named `linkedin-login`
- CDP is reachable at `http://127.0.0.1:9222` inside that container network namespace

Env vars:
- `CONTAINER_NAME` (default `linkedin-login`)
- `CDP_URL` (default `http://127.0.0.1:9222`)
- `N8N_WEBHOOK_URL` (optional)

## Webhook payload

Includes:
- `connectionSent` boolean
- `connect.reason` string (e.g. `pending_confirmed`, `skipped_company_url`, `follow_only_no_connect`, `no_pending_confirmation`)
