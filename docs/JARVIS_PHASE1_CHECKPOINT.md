# JARVIS Phase 1 Checkpoint — Core Façade

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **`lib/jarvis/core.js`** — `runJarvisTurn({ userId, message, conversaId, historico, channel })`
2. **Adapters** call Core only:
   - Web: `POST /api/ia/chat` → `runJarvisTurn({ channel: 'web' })`
   - WhatsApp: queue → `runJarvisTurn({ channel: 'whatsapp' })`
3. **Structured log** per turn: `tag=jarvis.turn` JSON (durationMs, provider, actionTypes, ok)
4. **WhatsApp security:** `WHATSAPP_WEBHOOK_SECRET` required when `NODE_ENV=production`
5. **Debounce:** default **1000 ms** (`WHATSAPP_DEBOUNCE_MS`)

## What did NOT change

- Prompt, actions, snapshot, project modules — same behavior
- `processarChat` still exists (implementation); external adapters must use Core

## Validate

1. WhatsApp: send “oi” — expect faster ack (~1s debounce) + reply as chefe
2. Railway logs: line with `"tag":"jarvis.turn","channel":"whatsapp"`
3. Web Assist: one message — same log with `"channel":"web"`
4. Confirm `WHATSAPP_WEBHOOK_SECRET` is set on Railway (already expected)

## Next (Phase 2 candidate)

AI Gateway minimal + snapshot cache — only after this checkpoint is green.

## Rollback

Point WhatsApp/Web back to `processarChat` direct calls; revert debounce/secret if needed.
