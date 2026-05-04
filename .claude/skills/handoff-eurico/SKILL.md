---
name: handoff-eurico
description: Produz handoff portátil seguindo o protocolo Handoff Central. Use quando sessão termina com trabalho incompleto, contexto crítico ou blocker que o próximo agente precisa. Cross-terminal ready. Evita re-explicação em sessões futuras.
version: 1.0.0
author: Eurico
---

# Handoff Skill — Protocolo Central do Ecosistema

## Propósito

Criar handoff que QUALQUER agente/terminal futuro encontra e consome. Segue `~/.claude/rules/handoff-central.md`.

**NÃO criar em `.aiox/handoffs/`.** Sempre em `docs/handoffs/` do projecto com entrada no `docs/HANDOFF-INDEX.md`.

## Quando invocar

- Fim de sessão com trabalho incompleto
- Blocker que precisa input humano ou outro agente
- Contexto crítico que não pode ficar só na memória da conversa
- Mudança de agente (`@sm` → `@dev`, etc.) entre sessões
- Antes de `/compact` pesado se contexto importante se vai perder

## Prefixo de projecto (obrigatório)

| Projecto | Prefixo |
|----------|---------|
| alturense-videos | `alt-` |
| ecosistema-ia-avancada-pt | `ecos-` |
| aiox-core | `aiox-` |
| kit-conformidade | `kc-` |
| fitcoach / Telmo | `fc-` |
| Outro | escolher kebab-case curto |

Formato: `{prefixo}-handoff-{slug}-{YYYYMMDD}.yaml`

## Checklist de execução

1. **Identificar projecto** e determinar prefixo
2. **Verificar pasta** `docs/handoffs/` existe — criar se não
3. **Copiar template** `docs/handoffs/TEMPLATE.yaml` se existir, senão usar template abaixo
4. **Preencher YAML** — ver secção template
5. **Adicionar linha no INDEX** — `docs/HANDOFF-INDEX.md` (topo da tabela Pending)
6. **Reportar ao utilizador**: path do handoff + linha adicionada no INDEX

## Template YAML

```yaml
from_agent: "{agente que cria — ex: dev, qa, ux-design-expert}"
to_agent: "{agente destinatário — ou 'any' se qualquer pode consumir}"
created: "{YYYY-MM-DDTHH:MM:SSZ}"
status: pending
consumed: false

project: "{nome do projecto}"
summary: "{1 parágrafo — aparece no INDEX, deve dar contexto sem abrir YAML}"

context:
  story_id: "{se aplicável — ex: KC-D.2}"
  story_path: "{path para story em docs/stories/active/}"
  branch: "{branch git activa}"
  current_task: "{o que estava a ser feito}"
  decisions_made:
    - "{decisão 1}"
    - "{decisão 2}"
  files_modified:
    - "{path 1}"
    - "{path 2}"
  blockers:
    - "{blocker 1 e porquê}"
  hypotheses_tested:
    - "{hipótese + resultado}"

next_action: "{accao concreta para o próximo — 1 frase imperativa}"

notes: |
  {contexto adicional livre — tom, urgência, avisos}
```

## Regras de ouro

| Regra | Detalhe |
|-------|---------|
| 1 handoff = 1 acção clara | 3 acções independentes = 3 handoffs separados |
| Project prefix obrigatório | Sem prefixo, handoff perde-se entre projectos |
| INDEX é fonte de verdade | Sempre actualizar a tabela Pending no topo |
| Nunca em `.aiox/handoffs/` | Apenas `docs/handoffs/` central |
| Stale > 7 dias | Se ficheiro pending > 7 dias, flaggar ao Eurico |

## Output esperado

Após execução, a skill reporta:

```
Handoff criado:
  Ficheiro: docs/handoffs/{prefixo}-handoff-{slug}-{data}.yaml
  INDEX:    docs/HANDOFF-INDEX.md (linha adicionada no topo Pending)
  Próximo:  {to_agent} lê o INDEX na próxima sessão e abre o YAML
```

## Referências

- Protocolo completo: `~/.claude/rules/handoff-central.md`
- Template oficial (se existir no projecto): `docs/handoffs/TEMPLATE.yaml`
- Leitura obrigatória na activação de agentes: `docs/HANDOFF-INDEX.md`
