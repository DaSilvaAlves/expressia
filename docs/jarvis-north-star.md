# Jarvis — North Star & Visão v2

> **Estado:** Rascunho de visão (2026-06-21). Substitui o paradigma do `docs/project-brief.md`/`docs/prd.md` v1.1 ("SaaS família-first com cérebro AI + Tarefas + Finanças"). Decisão do Eurico: **refazer**, não rever — é outro produto.

---

## 1. A visão (estrela polar)

**Jarvis é um assistente de vida conversacional, proactivo, que conhece o Eurico.**

Acorda com ele e fala primeiro. Sabe a agenda, os hábitos, o diário. Trata de email (lê, resume, escreve, responde), calendário, lembretes, pesquisa, decisões. **A conversa É o produto** — tarefas e finanças são apenas duas das muitas coisas que ele faz. Tem memória do utilizador e toma iniciativa (fala sem que lhe peçam).

Referência mental: o Jarvis do Homem de Ferro — um assistente de *vida*, não uma app de *produtividade*.

### O que isto NÃO é (e era, na v1)

- ❌ Um dashboard de tarefas/finanças com um chat encostado ao lado.
- ❌ Uma app onde o utilizador navega menus e preenche formulários.
- ❌ Um SaaS família-first PT-PT focado em gestão doméstica.

A v1 actual (Expressia) é competente como app, mas é o produto errado para esta visão. O chat tem de deixar de ser um painel lateral e passar a ser **a casa**.

---

## 2. Estratégia: pessoal agora, SaaS depois

**Decisão Eurico (21/06/2026):** construir primeiro o Jarvis *pessoal do Eurico* (um único utilizador real), provar a visão, e só depois generalizar para vender.

Implicações:

- **v1 optimiza para o Eurico**, não para um mercado. Sem onboarding multi-passo, sem billing, sem multi-tenant a complicar a v1. Já estamos em single-user (feature de família removida 19/06).
- **A infra de tenancy (`household_id`/RLS/EU) fica intacta** por baixo — é a porta aberta para o SaaS futuro, não trabalho a desfazer.
- **Métrica de sucesso da v1 não é conversão nem MRR** — é o Eurico abrir (ou ser acordado pelo) o Jarvis todos os dias porque tem valor real.

---

## 3. O que se reaproveita vs o que é novo (honesto)

**Reaproveita-se (o motor já existe e está provado):**

- Pipeline cognitivo classificar→planear→executar, com tool-calling tipado, transacção atómica e undo 30s. **Classificador provado a 95%** (benchmark 21/06). Passa a ser a *camada de acções* do Jarvis.
- Tarefas e Finanças deixam de ser "os módulos" e tornam-se **2 de N capacidades** que o assistente orquestra.
- Auth, dados na UE, RLS, observabilidade, jobs Inngest (cron) — fundação sólida.

**É novo (o coração da visão):**

- **Conversa-first** — a conversa como interface principal, com memória persistente do utilizador e do histórico.
- **Memória/conhecimento do utilizador** — agenda, hábitos, preferências, diário; o Jarvis "sabe coisas" sobre o Eurico.
- **Proactividade** — o Jarvis inicia (brief da manhã, alertas, sugestões), não só reage.
- **Integrações de vida** — email (Gmail), calendário (Google Calendar), e mais ao longo do tempo.
- **Capacidades de assistente** — escrever email, pesquisar, ajudar em decisões.

**Viabilidade:** tudo isto é construível com a stack actual (LLM tool-calling, MCP/OAuth para Gmail+Calendar, Inngest para proactividade agendada, memória em Postgres). Não é investigação — é integração bem conhecida. A integração OAuth com Google é trabalho novo mas trilhado.

---

## 4. v1 — A espinha: o Brief Diário Proactivo

**Decisão Eurico (21/06/2026):** a primeira capacidade que faz sentir "isto é o Jarvis".

### A experiência

De manhã, o Jarvis **fala primeiro**:

> *"Bom dia, Eurico. Hoje tens 3 coisas na agenda — a primeira é às 10h, reunião com X. Há 2 emails que pedem resposta (um do Y sobre Z). Tens 1 tarefa para hoje e 1 atrasada de ontem. Ontem gastaste 78,70€; este mês vais em 1.240€. Queres que trate de alguma coisa?"*

E o Eurico pode responder em conversa — *"responde ao Y a dizer que sim", "reagenda a reunião para as 11h", "adiciona tarefa..."* — e o Jarvis age.

### Porque é a espinha certa

Um bom-dia a sério **obriga** a juntar tudo o que define o Jarvis:
- **Agenda** (calendário) · **Email** (o que precisa de atenção) · **Tarefas** · **Finanças** — síntese de várias fontes.
- **Proactividade** — corre de manhã e entrega, sem o Eurico pedir.
- **Memória** — sabe o que é relevante para *ele*.
- **Conversa** — síntese em linguagem natural + acção a partir da resposta.

É a fatia mais fina que entrega a sensação inteira. Tudo o resto da visão (escrever email a pedido, pesquisa, decisões, diário) cresce a partir daqui.

### Canal: Telegram (decisão Eurico, 21/06/2026)

**O Jarvis vive no Telegram.** Um bot do Telegram é o interface da v1 — não há web app para a v1. Isto resolve a proactividade (o bot envia mensagens quando quiser), a conversa (é nativamente um chat), a identidade (o `chat_id` do Eurico é a autenticação — single-user) e elimina toda a UI web a construir. O backend existente (motor de tools, DB, tarefas/finanças, Inngest) fica por baixo. A web app Next.js passa a secundária (host do backend / futura superfície SaaS).

### O que a v1 precisa de ter

1. **Bot do Telegram** — webhook que recebe mensagens do Eurico e responde; envio proactivo via Bot API. Allowlist = `chat_id` do Eurico (single-user).
2. **Integração Google Calendar** (ler eventos de hoje).
3. **Integração Gmail** (identificar o que pede resposta; resumir) — **v1.1 imediato** (ver §6).
4. **Tarefas + Finanças no brief** — já existem; só agregar.
5. **Job proactivo** (Inngest cron de manhã) que compõe o brief e o envia ao Telegram.
6. **Síntese conversacional** — o LLM compõe o brief em PT-PT natural (não uma lista de widgets).
7. **Acção a partir da conversa** — responder ao brief no Telegram executa coisas (reusa o motor de tools classificar→planear→executar).

---

## 5. Roadmap de capacidades (o Jarvis completo, por fases)

| Fase | Capacidade | Notas |
|------|-----------|-------|
| **v1** | Brief diário proactivo (agenda+email+tarefas+finanças) + acção via conversa | A espinha |
| v1.x | Escrever/responder email a pedido · gerir calendário (marcar/reagendar) · lembretes proactivos | Aprofunda email+agenda |
| v2 | Memória rica (hábitos, diário, preferências) · pesquisa · apoio a decisões | O "sabe tudo" |
| v2.x | Voz (acordar e falar literalmente — TTS/STT) · mais integrações | "fale comigo" literal |
| v3 | Generalização SaaS (multi-utilizador, onboarding, billing) | Vender |

---

## 6. Decisões de âmbito v1 (Eurico, 21/06/2026)

1. **Canal = Telegram.** ✅ Decidido. O Jarvis é um bot do Telegram (ver §4). Sem web app na v1. Voz fica como evolução (v2.x).
2. **Integrações na v1.** ✅ Default assumido (Eurico corrige se quiser): primeiro brief = **Calendar + Tarefas + Finanças**; **Email (Gmail) entra em v1.1 imediato** a seguir (ler email é mais sensível e o OAuth demora mais — não atrasa a prova da espinha).

---

## 7. Restrições duras (não negociáveis)

- **Disciplina da espinha:** construir a v1 (brief) **até estar excelente** antes de alargar. O erro a evitar é o de hoje — amplo e a sentir-se incompleto. Profundidade antes de largura.
- **Confiança é o produto:** ler email e diário = dados íntimos. Segurança/privacidade de topo; dados na UE; transparência sobre o que o Jarvis acede.
- **Conversa-first:** qualquer decisão de UX que reduza a conversa a um painel secundário é contra a visão.

---

*Documento de visão por Claude Code com o Eurico, 2026-06-21. Próximo passo: confirmar as decisões §6, depois reescrever o PRD (Fase 1 = Brief Diário) com o @pm.*
