# Project Brief: meu-jarvis

**Autor:** Bob (PM Strategist), corrigido por Orion (aiox-master) após directiva do Eurico
**Data:** 2026-05-04
**Estado:** Draft v1.1 (PT-PT exclusivo após correcção do Eurico em 2026-05-04)
**Inputs:** `JARVIS.txt`, `docs/research/01-competitive-analysis.md`, memórias do projecto

---

## 1. Sumário Executivo

**meu-jarvis é um assistente pessoal AI multi-tenant para famílias e profissionais de Portugal — onde uma frase cria tarefas, lembretes, transações e eventos em simultâneo, com privacidade GDPR desde o dia 1 e integração e-fatura em roadmap.**

- **Conceito:** Assistente pessoal AI estilo Jarvis, multi-tenant, para mercado **Portugal continental (PT-PT exclusivo)**.
- **Inspiração:** O Néctar (concorrente brasileiro) provou que existe apetite por multi-intent AI; ignora completamente Portugal — janela aberta.
- **Mercado:** **Apenas Portugal**. Brasil/CPLP/lusófono fora do âmbito do projecto.
- **Proposta de valor:** Família privacy-first português com integração nativa ao ecossistema fiscal e bancário PT.

---

## 2. Problema

| Dor | Evidence | Impacto |
|-----|----------|---------|
| Vida operacional fragmentada | Utilizador típico usa Todoist + Notion + Excel + WhatsApp lembretes | 20-30 min/dia perdidos em context-switch |
| Ferramentas de finanças não falam com ferramentas de tarefas | Apps como FIZ ou agregadores bancários são silos | Decisões financeiras desligadas da agenda real |
| Assistentes AI sem persistência estruturada | ChatGPT/Claude são chat-only | Conhecimento perde-se após cada conversa |
| Mercado PT inexistente em assistentes pessoais AI | Néctar é `.com.br`, sem PT-PT, sem e-fatura, sem GDPR explícito | 10M+ falantes PT-PT sem oferta nativa |
| Ferramentas internacionais não integram realidade PT | Sem NIF, sem e-fatura, sem Multibanco/MB Way, sem Open Banking PT | Fricção operacional constante |

**Por que agora:** janela 12-18 meses (research Atlas §6.3) — Néctar não vai entrar em PT no curto prazo (foco BR e iOS only). Stack técnica é commodity, regulação PT é clara, ecossistema fiscal PT (e-fatura, AT) é API-friendly.

---

## 3. Solução Proposta

Plataforma SaaS multi-tenant **exclusivamente para o mercado português** com:

- **Cérebro AI multi-intent** (function calling): "amanhã reunião com o Paulo às 15h, paguei €78,70 no supermercado, lembra-me de rever as contas sexta" — três acções em diferentes módulos numa única frase.
- **Modelo família-first** desde o esquema (RLS por agregado familiar, não por user) — diferencial estrutural não replicável em 6 meses por concorrentes single-user.
- **Privacy-first GDPR**: export JSON/CSV sempre activo, audit log público de acções do agente, data residency UE obrigatória, eliminação de dados sob pedido em 30 dias.
- **Integração ecossistema PT** (roadmap Fase 2-3): import e-fatura, ligação a bancos PT via Open Banking PSD2, NIF como identificador fiscal, Multibanco/MB Way no checkout.
- **Pricing acessível** com freemium real e trial de 14 dias sem cartão.

---

## 4. Personas

### Persona 1 — João e Sofia, casal 38/35, Lisboa (primária — diferenciador família)
- Dois rendimentos, dois miúdos (5 e 8 anos), agenda partilhada.
- Hoje: Google Calendar partilhado, WhatsApp para lembretes, Excel para orçamento conjunto.
- Dor: nenhuma ferramenta integra a vida dos dois; orçamento está sempre desactualizado; lembretes perdem-se entre canais.
- Goal: orçamento de família que se actualiza sozinho, agenda da casa visível para ambos, despesas categorizadas automaticamente.

### Persona 2 — Inês, 36, advogada freelancer no Porto (primária — profissional liberal PT)
- Trabalha como ENI, factura via Portal das Finanças, multi-cliente.
- Hoje: Excel + Recibos Verdes online + Notion + Google Calendar.
- Dor: misturar despesas pessoais e ENI; perder facturas nos emails; sem visão consolidada de fluxo de caixa.
- Goal: organizar a vida em 5 min/dia com despesas pessoais e profissionais separadas mas vistas no mesmo sítio; preparar IRS sem panico em Janeiro.

### Persona 3 — Diogo, 29, engenheiro de software em Aveiro (secundária — Pro tier)
- Engenheiro PT remote para empresa europeia, mentalidade power-user.
- Hoje: Todoist Pro + Linear + Obsidian + Things.
- Dor: nenhuma ferramenta tem API decente; quer automatizar via webhooks; quer dados sempre no seu controlo.
- Goal: assistente que se integra no seu fluxo dev (API pública, webhooks, export JSON/CSV).

---

## 5. Proposta de Valor vs Néctar

| Dimensão | Néctar | meu-jarvis |
|----------|--------|------------|
| Mercado-alvo | Brasil exclusivo | **Portugal exclusivo** |
| Língua | PT-BR | **PT-PT** |
| Multi-utilizador | Não (single-user) | **Sim, multi-tenant família/casal** |
| Privacy | Não declarada | **GDPR-first, export sempre activo, audit log** |
| Trial | Não | **14 dias sem cartão** |
| Pricing | R$400/ano single | **Freemium + 4 tiers, mensal e anual** |
| Integração fiscal | Não | **e-fatura PT (Fase 2)** |
| Integração bancária | Não | **Open Banking PT (Fase 2-3)** |
| Plataforma móvel | iOS only | Web responsiva (Fase 1) → Android (Fase 2) → iOS (Fase 3) |
| API pública | Não | **Sim no plano Pro** |
| Bus factor | Founder dependency | Equipa estruturada |

---

## 6. Modelo de Negócio (PT-PT exclusivo)

| Plano | Preço | Limites | Target |
|-------|-------|---------|--------|
| **Free** | €0 | 1 módulo (Tarefas OU Finanças), 50 prompts/mês, sem canais externos | Aquisição |
| **Pessoal** | €4,90/mês ou €49/ano | Todos os módulos da Fase 1, 1 utilizador | Profissionais individuais |
| **Família** ⭐ | **€8,88/mês ou €89/ano** | Tudo + 4 utilizadores, orçamento conjunto, agenda família | **Tier hero — diferencial estrutural** |
| **Pro** | €14,90/mês | Família + API pública, audit log avançado, suporte prioritário | Power users e devs |

- **Trial:** 14 dias com features completas, sem cartão. Conversão alvo 8-10%.
- **Billing:** Stripe (PT) com pagamento via cartão + Multibanco/MB Way (Stripe suporta PT payment methods nativamente).
- **Faturação:** mensal default, anual com desconto ~17%. Factura electrónica PT obrigatória desde dia 1 (NIF do cliente).

**[DECIDIDO POR PM:]** Plano **Família é o tier hero a €8,88/mês** — toda a copy de aquisição lidera com este preço. É o diferencial difícil de copiar pelo Néctar.

---

## 7. Métricas de Sucesso

### North Star Metric
**Active Households per Week (AHW)** — número de agregados familiares com pelo menos 1 prompt no cérebro AI nos últimos 7 dias.

Justificação: capta engagement real (não login) e o ângulo família (não user individual), que é o nosso diferencial.

### OKRs Trimestre 1 (Fase 1 MVP em produção em PT)

**O1: Validar tracção em Portugal.**
- KR1: 500 utilizadores registados (orgânico + 2 campanhas pequenas em PT)
- KR2: 100 trials iniciados, 10 conversões pagas
- KR3: NPS >= 30 nos pagantes

**O2: Provar viabilidade técnica do cérebro multi-intent em PT-PT.**
- KR1: Latência p95 do prompt multi-intent < 6s
- KR2: Precisão de classificação multi-intent >= 90% em PT-PT (avaliação manual de 200 prompts)
- KR3: Zero incidentes de cross-tenant data leak (RLS auditada)

**O3: Construir base de produto sustentável.**
- KR1: 70% test coverage em packages core (cérebro, finanças, tarefas)
- KR2: CI/CD com lint+typecheck+test bloqueante em main
- KR3: Deploy a produção em <10 min, rollback em <2 min

---

## 8. Riscos Top 5 e Mitigações

| # | Risco | Severidade | Mitigação |
|---|-------|-----------|-----------|
| 1 | Néctar capta funding e entra em PT nos próximos 6 meses | Média | Lock-in via integração e-fatura PT (barreira regulatória); construir comunidade PT cedo; multi-tenant família é refactor caro para eles |
| 2 | Custo LLM em escala torna-se incomportável | Alta | Router de modelos: GPT-4o-mini para classificação, Claude Sonnet para multi-intent execution; cache agressiva; quotas por plano |
| 3 | Função multi-intent não atinge precisão >=90% em PT-PT | Alta | Fase 1 fallback: se confidence < 70%, mostra preview ao utilizador antes de executar; benchmark próprio com 200 prompts PT-PT antes do launch |
| 4 | Mercado PT é demasiado pequeno para sustentar burn rate | Média | Bootstrap inicial com burn rate baixo (single dev → small team); Família tier permite ARPU mais alto vs single-user; expansão geográfica fora do âmbito declarado |
| 5 | Stripe + e-fatura + KYC PT introduzem fricção no setup | Média | Billing como Epic 6 dedicado; iniciar setup fiscal PT no dia 1 do dev (paralelo com produto); integração Stripe PT bem documentada |

---

## 9. Roadmap Macro

### Fase 1 — MVP (este PRD, 3-4 meses dev)
Cérebro multi-intent, Tarefas, Finanças, Web app, Auth multi-tenant, Onboarding, Billing Stripe, **PT-PT exclusivo**. Lançamento em Portugal.

### Fase 2 — Expansão de canais e módulos (3 meses)
WhatsApp, Telegram, Google Calendar sync, Hábitos, Projectos, Lembretes, Metas, Diário, Brain Dump, Android nativo, **integração e-fatura PT**.

### Fase 3 — Voice, OCR e Conhecimento (3 meses)
Voice mode tempo real, OCR de comprovantes/recibos PT, módulo Conhecimento + pesquisa web, **Open Banking PT** (PSD2), iOS nativo.

### Fase 4 — Plataforma (6+ meses)
Alexa, API pública (plano Pro), marketplace de integrações, integrações com PRIMAVERA/MOLONI/Recibos Verdes para freelancers PT.

> Expansão geográfica fora de Portugal **não está no roadmap**. Se vier a ser considerada, é decisão futura do Eurico, não assumption do produto.

---

## 10. Considerações Técnicas (input para @architect)

- **Frontend:** Next.js (App Router) + TypeScript — confirmado.
- **Backend:** TypeScript/Node — confirmado.
- **Database:** PostgreSQL com Row-Level Security multi-tenant desde o dia 1 — confirmado.
- **Repository:** Monorepo (npm workspaces ou pnpm) — `[DECIDIDO POR PM:]` alinha com convenção AIOX.
- **Architecture:** Monolito serverless (Next.js full-stack) na Fase 1, evolução para serviços dedicados se necessário.
- **Hosting:** Vercel + Postgres gerido (Supabase ou Neon) **com data residency UE obrigatória** — `[DECIDIDO POR PM:]` baixo overhead operacional + GDPR compliance built-in.
- **AI provider:** Anthropic Claude (Sonnet) como executor primário, OpenAI GPT-4o-mini como classificador de intent — `[DECIDIDO POR PM:]` Claude Sonnet superior em function calling multi-intent + PT-PT; GPT-4o-mini barato para classification.
- **Auth:** Supabase Auth ou Clerk — decisão @architect.
- **Billing:** Stripe com payment methods PT (cartão, Multibanco, MB Way) — `[DECIDIDO POR PM:]` único provider necessário, suporta PT nativamente.
- **Observability:** stack OpenTelemetry-compatível desde Epic 1 (não como afterthought) — Constitutional NFR.
- **i18n:** PT-PT único no MVP. Hooks de i18n NÃO são prioridade — adicionar apenas se houver decisão futura de expansão.

---

## 11. Constraints e Assumptions

**Constraints:**
- **Mercado:** **Portugal exclusivo**. Não construir para BR, CPLP, lusófono ou expansão internacional. Esta é decisão do Eurico (2026-05-04), inegociável no MVP.
- **Língua:** PT-PT único. Sem PT-BR, sem EN, sem multi-língua no MVP.
- **Timeline:** MVP em 3-4 meses para captar janela competitiva.
- **Budget:** assumido bootstrap inicial; LLM API budget mensal a definir com @architect.
- **Technical:** Next.js + TS + Postgres não-negociável. Multi-tenant desde dia 1 não-negociável.
- **Compliance:** GDPR obrigatório à entrada em produção; data residency UE obrigatória.
- **Pricing:** Plano Família €8,88/mês fixado pelo Eurico — não alterar sem nova directiva.

**Assumptions a validar:**
- Mercado PT aceita SaaS produtividade pago mensal (sinal positivo: PRIMAVERA, MEO B2B, Worten Cloud têm tracção).
- Função multi-intent é o diferenciador-chave (validado pelo demo Néctar e pelo `JARVIS.txt`).
- Conversão freemium-to-paid em produtividade é >=8% (benchmark Notion, Todoist).
- Família é unidade de uso real, não indivíduo (apoiado por research, não validado em PT).

---

## 12. Próximos Passos

1. PM (Bob) entrega este brief + PRD a @architect para architecture document.
2. @architect decide: AI provider final, ORM (Prisma vs Drizzle), Auth provider, vector store strategy.
3. @ux-design-expert produz front-end-spec a partir do PRD UI Goals.
4. @sm cria épicos detalhados e primeiras stories da Fase 1.

---

*Brief preparado por Bob (PM AIOX) em 2026-05-04, corrigido por Orion (aiox-master) na mesma data após directiva do Eurico para focar PT-PT exclusivo. Pronto para servir de input ao PRD.*
