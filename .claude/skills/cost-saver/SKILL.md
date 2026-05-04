---
name: cost-saver
description: Guia de decisão rápida para poupar tokens/custo — model routing, session limits, paralelização, compact timing. Invocar quando sentes sessão a ficar cara ou antes de tarefas longas.
version: 1.0.0
author: Eurico
---

# Cost Saver — Guia de Decisão

## Propósito

Dar decisões rápidas de poupança de custo **sem sacrificar qualidade**. Baseado no insights report abril 2026 (823h, 186 sessões).

## Decisão 1: Que modelo?

| Tarefa | Modelo | Porquê |
|--------|--------|--------|
| Lookup / Read / Grep | Haiku | Baixa complexidade, rápido |
| Summary / writer tasks | Haiku | Output estruturado simples |
| Implementação standard | Sonnet | Default razoável |
| Debugging normal | Sonnet | Suficiente para 80% dos casos |
| QA review padrão | Sonnet | Checklist-driven |
| Devops (git, CI) | Sonnet | Operações determinísticas |
| Arquitectura / design system | Opus | Trade-offs e abstrações |
| Deep analysis / research | Opus | Multi-source synthesis |
| Debugging complexo (3+ hipóteses) | Opus | Reasoning profundo |
| Code review crítico | Opus | Catch de bugs subtis |
| Critic / verifier | Opus | Julgamento independente |

**Regra rápida:** "Consigo explicar a tarefa em 1 frase sem trade-offs?" → Sonnet ou Haiku.

## Decisão 2: Compact quando?

| Sinal | Acção |
|-------|-------|
| Contexto ~70% | `/compact` preventivo |
| Repetição de hipóteses | `/compact` + redirect |
| Agente em philosophical mode | `/compact` + handoff |
| Antes de tarefa nova longa | `/compact` para começar fresco |
| Após 5min sem tool call | Cache TTL a expirar — usar ou perder |

**Nunca:** deixar passar 80% sem compact.

## Decisão 3: Paralelizar ou serializar?

| Cenário | Decisão |
|---------|---------|
| 3 files independentes para ler | Paralelo (1 mensagem, 3 Read) |
| lint + typecheck + test | Paralelo (3 Bash) |
| copy + visual + hashtags | Paralelo (3 Task com subagents) |
| output A é input de B | Serializar |
| debug com hipóteses | 2-3 probes em paralelo primeiro |

## Decisão 4: Subagent ou inline?

| Condição | Delegar a subagent |
|----------|---------------------|
| Task consumiria >20% do contexto actual | SIM |
| Pesquisa exploratória (muitos greps) | SIM (Explore agent) |
| Domain-specific (legal, copy, design) | SIM |
| Pode correr em paralelo com outro | SIM |
| Edição trivial de 1 ficheiro | NÃO |
| Resposta curta factual | NÃO |

## Decisão 5: Session length

| Duração | Acção |
|---------|-------|
| < 60min | Continua |
| 60-90min | Avalia se converge — senão handoff |
| > 90min sem shipping | HANDOFF OBRIGATÓRIO + fresh session |
| Debug > 2h sem root cause | STOP, formalizar hipóteses, próxima sessão |

## Decisão 6: Evitar rework (maior fonte de custo)

Antes de editar/propor:
1. Li o PRD relevante? **Sim/Não**
2. Li o handoff mais recente? **Sim/Não**
3. Li o CLAUDE.md do projecto? **Sim/Não**
4. Consultei fontes canónicas (schema, endpoints, tokens)? **Sim/Não**

Se algum "Não" sem justificação → LER PRIMEIRO. O restart custa mais do que a leitura.

## Red flags de desperdício

| Sinal | O que fazer |
|-------|-------------|
| Inventar endpoint/path/label | STOP, verificar contra fonte real |
| Tratar sintoma em vez de root cause | STOP, formular 2-3 hipóteses |
| 3+ iterações no mesmo fix | Handoff + fresh perspective |
| Philosophical framing em pedido de execução | Cortar, executar |
| Confirmation-seeking em tarefa clara | Cortar, executar |

## Referências

- Memórias: `feedback_read_before_edit_cost`, `feedback_model_routing_costs`, `feedback_session_limits_cost`, `feedback_parallel_tool_calls_cost`
- Insights report: `~/.claude/usage-data/report.html`
