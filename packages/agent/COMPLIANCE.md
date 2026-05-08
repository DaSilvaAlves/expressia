# `@meu-jarvis/agent` — Compliance Notes

> Documento curto de excepção NFR11 (Data Residency UE). Trace: Story 2.2 AC11 + Architecture §12.2 + PRD NFR11.

## Excepção NFR11 (Data Residency UE)

A política da Expressia exige residência UE para todos os dados de utilizador (NFR11). Os providers LLM **Anthropic** e **OpenAI** **NÃO** têm garantia de região UE para as suas APIs em 2026 — a chamada técnica viaja inevitavelmente para infra US-host.

Esta excepção está formalmente reconhecida em `docs/architecture.md §12.2` (linha 924).

## Constraints obrigatórios em runtime

A excepção só é aceitável com **todas** as protecções abaixo activas:

| Constraint | Estado | Notas |
|------------|--------|-------|
| **DPA UE assinado** | Pendente provisão (EB1/EB2) | Anthropic Sales (não-self-serve) + OpenAI Enterprise |
| **Zero retention** (logs/conversas não armazenados pelo provider) | Pendente provisão | Negociar via DPA |
| **No training** on inputs/outputs | Pendente provisão | Negociar via DPA |
| **SCC (Standard Contractual Clauses)** UE→US | Pendente provisão | Provider-side compliance |
| **Hash-only logs** locais (NUNCA prompt content em logs) | ✅ Activo | `redactProviderPayload` + `PII_REDACT_PATHS` (ver `redaction.ts`) |
| **Span attributes whitelist** (sem PII em traces) | ✅ Activo | `PROVIDER_SPAN_ATTRIBUTE_KEYS` em `tracing.ts` |
| **Errors sem PII** | ✅ Activo | `sanitizeHint` em `errors.ts` |

## Campos NUNCA logados ou tracejados pelo package agent

- `system` (system prompt) — pode conter PII em templates Story 2.4+
- `messages[].content` — prompt original do utilizador (PII)
- `tools[].input_schema` — verboso e desnecessário em logs

Ver `src/redaction.ts` `REDACTED_FIELD_NAMES` para a lista canónica.

## Próximas acções

1. **Story 2.2 (esta)**: package implementa redaction + tracing whitelist + errors sem PII.
2. **Sprint Fase 2** (a calendarizar):
   - Provisionar EB1 (Anthropic) e EB2 (OpenAI) com DPA UE assinado
   - Criar `docs/compliance/llm-data-residency.md` com texto auditable (SOC-2 / ISO-27001 ready)
   - Re-avaliar providers UE-native (Mistral, Anthropic EU se anunciada) — Architecture §12.2 nota residual risk
3. **Story 2.10 (Benchmark)**: smoke E2E real só após DPA assinados.

## Auditoria

- **Última revisão**: 2026-05-08 (Story 2.2 v1.1 — `@po` GO 9.5/10).
- **Próxima revisão**: a marcar em sprint Fase 2 após provisão EB1/EB2.
- **DPO**: `dpo@meu-jarvis.pt` (ver Architecture §12.1).
