# JARVIS Phase 5 Checkpoint — Permission Engine + HITL

**Date:** 2026-09-17  
**Status:** IMPLEMENTED — awaiting production validation

## What shipped

1. **`lib/jarvis/permissions/approvals.js`** — tabela `jarvis_approvals` (pending / approved / rejected / expired / superseded), TTL 10 min
2. **`lib/jarvis/permissions/engine.js`** — split auto vs gated; `parseApprovalReply` (SIM/NÃO); `tryHandleApprovalReply`
3. **`runToolBatch`** — segura tools com `needsApproval` (risk ≥ `JARVIS_APPROVAL_THRESHOLD`, default `high`); `skipHitl` após confirmação
4. **`processarChat`** — trata SIM/NÃO **antes** da IA; resposta com id curto da aprovação
5. **`reconciliarRespostaComAcoes`** — anexa prompt de confirmação; não conta pending como fail genérico
6. Env: `JARVIS_HITL`, `JARVIS_APPROVAL_THRESHOLD`, `JARVIS_APPROVAL_TTL_MS`
7. `/api/ia/status` → `hitl` + `approvalThreshold`

## UX

```
Você: provisiona fulano no cinerush
Jarvis: ⚠️ Ação HIGH aguardando confirmação (a1b2c3d4): cinerush_provisionar (…)
        Responde SIM pra executar ou NÃO pra cancelar.
Você: SIM
Jarvis: (executa)
```

## What did NOT change

- Risk catalog (ainda Phase 3 definitions)
- Sem botões Evolution — texto SIM/NÃO
- medium/low tools seguem auto

## Validate

1. Pedir provisionar / apagar tx / fundir categorias → **não** executa; pede SIM
2. `SIM` → executa; log `jarvis.approval` + `jarvis.tool`
3. `NÃO` → cancela
4. `JARVIS_HITL=0` no Railway → bypass (só se precisar)

## Next (Phase 6 candidate)

Project Registry — catálogo Atlas/CineRush/Attracione com aliases NL.

## Rollback

`JARVIS_HITL=0` imediato; ou reverter `runToolBatch` / bloco HITL em `processarChat`.
