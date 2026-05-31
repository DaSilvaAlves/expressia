# Epic 6 — Onboarding e Billing

**Status:** v1.0 Validated — 8 DPs validadas por Eurico (2026-05-29). Story 6.1 Done (em produção). Detalhamento das restantes stories desbloqueado.
**Owner:** @pm (Morgan)
**Created:** 2026-05-29
**Validated:** 2026-05-29
**Depends on:** Epic 1 Done · Epic 2 Done · Epic 3 Done · Epic 4 Done · Epic 5 9/10 Done (shell + `<ChatPanel>` + `<EmptyState>` + `WidgetGrid` entregues; resta só 5.10 responsive sweep, não-bloqueante para o arranque do Epic 6).
**Estimated total effort:** L (≈ 10 stories, mistura S/M/L; 2-3 L nas integrações Stripe + jobs GDPR).

---

## 1. Visão e Valor de Negócio

O Epic 6 **fecha o loop comercial**. Depois de cinco epics a construir cérebro, multi-tenancy, tarefas, finanças e a casca visual, este é o epic que transforma o produto numa **operação que cobra** — registo limpo, onboarding que mostra valor em < 3 minutos (FR30/AC1), trial de 14 dias sem cartão (FR33), checkout Stripe com os meios de pagamento que o mercado PT usa de facto (cartão + **Multibanco** + **MB Way** — FR36), e factura electrónica compatível com a Autoridade Tributária (FR35). Sem o Epic 6 o produto está completo mas não monetiza.

O valor competitivo vs Néctar (BR) é estrutural e difícil de copiar: (1) **pricing PT-nativo com o tier Família a €8,88 como hero** — toda a copy de aquisição lidera com este preço (project-brief §pricing; directiva Eurico), enquanto o Néctar não tem oferta familiar multi-tenant nem preço em EUR; (2) **conformidade fiscal e GDPR PT desde o dia 1** — factura com NIF (FR35), export de dados sempre activo (FR28), eliminação com purge real a 30 dias (FR29) — barreiras regulatórias que o Néctar teria de construir de raiz para entrar em PT; (3) **meios de pagamento locais** — Multibanco e MB Way removem a fricção do cartão, decisiva no segmento famílias português.

A defensabilidade reforça-se porque o Epic 6 assenta sobre infra que **já existe no schema** (subscriptions, invites, feature_flags, modelo Stripe na architecture §6) — o trabalho é maioritariamente *fluxo + integração + UI + jobs*, não fundação nova. Isto reduz risco de execução e acelera o time-to-revenue.

## 2. Objectivo

No fim do Epic 6, um visitante novo pode: registar-se com email+password e confirmar o email (FR24); passar por um onboarding de 3 passos (tour do chat + criar tarefa exemplo + criar finança exemplo) que cria o household default e activa automaticamente um trial de 14 dias sem cartão (FR30/FR33); saltar o onboarding mantendo o trial activo (FR31); ao fim de 14 dias, regredir automaticamente para Free se não fizer upgrade (FR33); fazer upgrade para Pessoal/Família/Pro via Stripe Checkout com cartão, Multibanco ou MB Way (FR32/FR36); mudar de plano com pró-rata (FR34); convidar membros do household respeitando os limites por plano (Pessoal=1, Família=4, Pro=10 — FR27); exportar todos os seus dados em JSON+CSV (FR28); pedir a eliminação da conta com purge agendado a 30 dias revogável (FR29); ver as suas facturas no painel, cada uma com NIF e número sequencial AT-friendly (FR35). Satisfaz as ACs do PRD §6 Epic 6 (AC1-AC7).

## 3. Scope

### IN

- **Registo + verificação de email (FR24)** — completar e aplicar branding (front-end-spec §3) ao fluxo `/registar` que a Story 1.5 entregou funcionalmente; confirmação de email via Supabase Auth nativo (DP1). Criação do household default + membership `owner` no acto do registo.
- **Onboarding 3 passos (FR30/FR31)** — tour pós-registo: (1) demo do chat (escrever um prompt exemplo), (2) criar tarefa exemplo, (3) criar finança exemplo. Activa trial 14d automaticamente. Saltável; o trial activa-se sempre. Toast "Bem-vindo, {nome}." na primeira navegação (adiado do Epic 5 §3-OUT).
- **Setup Stripe (FR32/FR36)** — produtos + prices EUR (architecture §6.1: Pessoal €4,90/€49, Família €8,88/€89, Pro €14,90/€149), payment methods PT (`card`, `multibanco`, `mb_way`), webhook handler `POST /api/billing/webhook` (verify signature + idempotência via `payment_events.stripe_event_id` PK) + handler idempotente Inngest `stripe.event` (architecture §6.3).
- **Trial 14 dias automático (FR33)** — `subscriptions.status='trialing'` + `trial_ends_at` sem Stripe customer; job Inngest `expire-trials` (cron diário via `/api/cron/daily`) regride a Free quando expira.
- **Página de upgrade — 4 planos + Stripe Checkout (FR34)** — `/conta/plano` com os 4 planos, **Família €8,88 destacado como hero**, checkout Stripe hosted (DP4) com os 3 payment methods.
- **Mudança de plano pró-rata (FR34)** — upgrade imediato (pró-rata), downgrade no fim do período (`cancel_at_period_end`), ajuste imediato do limite de membros e das feature flags derivadas do plano.
- **Convite de membros do household (FR27)** — UI de convite (owner/admin) + `POST /api/household/invites` + email Resend com link `/aceitar-convite/{token}` + função SQL `accept_invite()` (architecture §5.3) que valida o limite do plano (defesa em profundidade) + UI de aceitação.
- **Export GDPR (FR28)** — `/conta/exportar`: enqueue job Inngest que percorre todas as tabelas com `household_id`, escreve ZIP (JSON+CSV) em Supabase Storage (eu-central-1) e envia signed URL (24h) por email. Requer tabela nova `data_export_jobs`.
- **Eliminação de conta + purge 30 dias (FR29)** — `/conta/eliminar`: cria job de purge agendado a 30 dias, **revogável até execução**; job Inngest executa o purge real (ON DELETE CASCADE em `household_id` garante consistência). Requer tabela nova `account_deletion_jobs`.
- **Painel de billing/faturas + factura electrónica PT (FR35)** — `/conta/faturas` lista as `invoices` do household; cada pagamento (`invoice.paid`) gera factura com NIF do cliente (quando fornecido) e número sequencial AT-friendly (`FT 2026/0001` — DP6).
### OUT (adiar para Fase 2 ou outro epic)

- **Social login (Google/Apple)** — FR24 menciona-o como opção; adiar para Fase 2 (email+password cobre o MVP).
- **MFA TOTP obrigatório para owners Pro** — architecture §5.4 prevê-o; opt-in nativo do Supabase chega, obrigatoriedade adia-se.
- **Open Banking / import e-fatura PT** — Fases 2-3 (project-brief §roadmap; explicitamente fora do MVP).
- **Dunning avançado / recuperação de pagamentos falhados além do email +0/+3/+7d** — architecture §6.3 define o básico; orquestração avançada é Fase 2.
- **Faturação anual com gestão de migração mensal↔anual complexa** — suportar anual no checkout (prices existem) mas migrações mensais↔anuais pró-rata complexas adiam-se se a DP6 mostrar complexidade fiscal.
- **Household switcher + multi-household (Pro)** — DP8=B: o switcher básico **adia-se para a Fase 2** (slot do shell fica desenhado mas inactivo no MVP); gestão avançada (renomear, sair, transferir ownership) também é Fase 2. Multi-household é caso Pro de nicho.
- **Cupões/descontos/campanhas promocionais** — fora do MVP.

## 4. Estado Actual (pré-condição verificada)

> **Achado de planeamento (2026-05-29).** Ao contrário do Epic 5 (que partiu sem design system), o Epic 6 herda **schema e modelo de dados já desenhados** — verificação byte-a-byte contra `packages/db/src/schema/` + `docs/architecture.md` confirma que a fundação de billing/tenancy/GDPR existe. O trabalho do Epic 6 é **fluxo + integração Stripe + UI + jobs Inngest**, não modelação de dados nova (excepto 2 tabelas GDPR).

**O que já existe:**

| Artefacto | Estado | Localização |
|-----------|--------|-------------|
| Schema `subscriptions` (trial_ends_at, stripe ids, status enum c/ `past_due_pending`, 1-por-household, currency EUR check) | Aplicado | `packages/db/src/schema/billing.ts:71` |
| Schema `payment_methods` (`card`/`multibanco`/`mb_way`) | Aplicado | `billing.ts:115` |
| Schema `invoices` (invoice_number AT, NIF check 9 dígitos, amount_cents, PDF url) | Aplicado | `billing.ts:149` |
| Schema `payment_events` (PK `stripe_event_id` — idempotência webhook) | Aplicado | `billing.ts:197` |
| Schema `households` (plan denormalizado, owner, locale pt-PT, currency EUR) | Aplicado | `packages/db/src/schema/tenancy.ts:47` |
| Schema `household_members` (pivot user×household, role owner/admin/member) | Aplicado | `tenancy.ts:81` |
| Schema `household_invites` (token, expires_at, accepted_by, unique pendente por email) | Aplicado | `tenancy.ts:115` |
| `planTierEnum` (free/pessoal/familia/pro) + `householdRoleEnum` | Aplicado | `tenancy.ts:31,34` |
| Schema `feature_flags` (por household, plan-derived) | Aplicado | `packages/db/src/schema/audit.ts:252` |
| Acções de audit billing/invite (`plan_changed`, `household_invite_sent/accepted/revoked`) | Aplicado | `audit.ts:35,47` |
| Páginas auth `/entrar` `/registar` `/recuperar` + `actions.ts` (funcionais, sem onboarding) | Funcional Story 1.5 | `apps/web/src/app/(auth)/` |
| Modelo Stripe (produtos/prices EUR), payment methods PT, webhook flow, eventos tratados | Especificado | `architecture.md §6.1-6.3` |
| Fluxo de convites + função SQL `accept_invite()` + limites por plano | Especificado | `architecture.md §5.3` |
| Infra Inngest (client + 3 jobs + route) + Vercel Cron diário `/api/cron/daily` | Funcional Epics 2-4 | `apps/web/src/lib/inngest/`, `apps/web/vercel.json` |
| Shell com slot `HouseholdSwitcher` + `<EmptyState>` + `<ChatPanel>` + `WidgetGrid` | Funcional Epic 5 | `apps/web/src/components/shell/`, `packages/ui/` |
| Resend (EU) para email transaccional | Stack escolhido | `architecture.md:124` |

**O que NÃO existe (é o trabalho do Epic 6):**

- **Tabelas GDPR `data_export_jobs` + `account_deletion_jobs`** — referidas em `architecture.md:169` mas **não existem** em `packages/db/src/schema/`. Migration nova (Stories 6.8/6.9), cada uma com RLS (NFR5).
- **Integração Stripe runtime** — nenhum código Stripe existe (`grep stripe` em `apps/web` retorna apenas referências de schema/docs). Cliente Stripe, checkout, webhook handler, Inngest `stripe.event` handler — tudo novo.
- **Jobs Inngest de billing/GDPR** — `expire-trials`, `stripe.event`, `gdpr-export`, `gdpr-purge` não existem (só recurrences + cleanup-reverse-ops).
- **Fluxo de onboarding** — `/registar` cria conta mas não há household-creation atómica, nem tour 3-passos, nem activação de trial.
- **Função SQL `accept_invite()`** — especificada na architecture §5.3 mas não implementada.
- **Páginas `/conta/plano`, `/conta/faturas`, `/conta/exportar`, `/conta/eliminar`, `/aceitar-convite/{token}`** — nenhuma existe.
- **Emissão de factura PT com numeração sequencial AT** — lógica de `invoice_number` (`FT 2026/0001`) não implementada (coluna existe, geração não).
- **Geração de feature flags derivadas do plano** — tabela existe; lógica de derivação plano→flags não.

## 5. Stories Propostas (alta-nível, ordem sugerida)

**Progresso: 1/10 Done** (6.1). Próximas prioritárias: 6.3 (Stripe setup — gargalo do ramo billing) e 6.2 (onboarding).

| Story | Título | Objectivo (1 frase) | Estimate | Dependências | Estado |
| ----- | ------ | ------------------- | -------- | ------------ | ------ |
| 6.1 | Registo + verificação de email + branding auth | Branding das páginas de auth com tokens `@meu-jarvis/ui`; verificação de email nativa Supabase (DP1: callback + `/confirm`); verificar bootstrap household/trial do registo (DP2/DP3, já entregue na 1.5). | M | Epic 1 (1.5 Done) | **Done** (PASS 9,3/10) |
| 6.2 | Onboarding 3 passos + activação de trial | Tour pós-registo (chat → tarefa → finança); cria `subscriptions{status:'trialing', trial_ends_at:now+14d}` sem Stripe customer; saltável mas trial sempre activa (FR30/FR31/FR33). | M | 6.1 |
| 6.3 | Setup Stripe + webhook handler idempotente | Produtos/prices EUR, payment methods PT (`card`/`multibanco`/`mb_way`), `POST /api/billing/webhook` (verify signature + upsert `payment_events`) + Inngest `stripe.event` handler (FR32/FR36; architecture §6.3). | L | Epic 1 (DevOps Stripe keys) |
| 6.4 | Trial expiry — job Inngest `expire-trials` | Cron diário lê `subscriptions WHERE trial_ends_at <= now() AND status='trialing'` → regride household a Free (FR33). Idempotente. | S | 6.2, 6.3 |
| 6.5 | Página de upgrade (4 planos) + Stripe Checkout | `/conta/plano` com 4 planos (Família €8,88 hero), Stripe Checkout hosted (DP4) com 3 payment methods; UI "aguardar pagamento" para Multibanco (`past_due_pending` — DP5). | M | 6.3 |
| 6.6 | Mudança de plano (upgrade/downgrade pró-rata) | Upgrade imediato pró-rata; downgrade no fim do período (`cancel_at_period_end`); ajuste imediato de limite de membros + feature flags derivadas (FR34). | M | 6.5 |
| 6.7 | Convite de membros + limites por plano | UI convite + `POST /api/household/invites` + email Resend + função SQL `accept_invite()` (valida limite Pessoal=1/Família=4/Pro=10) + página `/aceitar-convite/{token}` (FR27; architecture §5.3). | M | 6.1 |
| 6.8 | Export GDPR (JSON + CSV) | Tabela `data_export_jobs` (+RLS); `/conta/exportar` enfileira Inngest `gdpr-export` → ZIP em Supabase Storage → signed URL 24h via Resend (FR28/AC5). | M | 6.1 |
| 6.9 | Eliminação de conta + purge 30 dias | Tabela `account_deletion_jobs` (+RLS); `/conta/eliminar` agenda purge a 30d revogável; Inngest `gdpr-purge` executa purge real (FR29/AC6). | M | 6.1 |
| 6.10 | Painel de faturas + recibo PT (NIF) | `/conta/faturas` lista `invoices`; `invoice.paid` gera **recibo simples com NIF** (DP6=C — MVP) + PDF (FR35/AC7). Numeração sequencial AT certificada **adiada p/ Fase 2** (confirmar requisitos AT antes — AT-FISCAL-RESEARCH). | M | 6.3 |

**Total estimado:** 10 stories — 1×S, 8×M, 1×L (6.3) — alinhado com precedentes Epic 4/5 (10 stories cada).

> **Paralelização possível:** 6.1 (Done) era o caminho crítico inicial. Após 6.1: o ramo **billing** (6.3 → 6.4/6.5 → 6.6 → 6.10) e o ramo **household/GDPR** (6.7, 6.8, 6.9) podem correr em paralelo. 6.3 (Stripe setup) é o gargalo do ramo billing — priorizar cedo (bloqueador externo STRIPE-SETUP). Switcher de household **fora do âmbito** (DP8=B — Fase 2).

## 6. Riscos Macro

| ID | Risco | Probabilidade | Impacto | Mitigação proposta |
| -- | ----- | ------------- | ------- | ------------------ |
| R-6.1 | **Webhooks Stripe — idempotência e ordem de eventos.** Eventos fora de ordem (ex.: `subscription.updated` antes de `created`) ou duplicados corrompem `subscriptions`. | Alta | Alto | PK `stripe_event_id` em `payment_events` (existe) + handler Inngest com own idempotency key `stripe:{event_id}`. Upsert por `stripe_subscription_id`. Testes com replays de eventos fora de ordem. Verify signature obrigatório (raw body). |
| R-6.2 | **Multibanco assíncrono (3-7 dias).** Pagamento não confirma em segundos; estado `past_due_pending` precisa de UX clara e de não bloquear o utilizador injustamente. | Alta | Médio | DP5 decide o nível de acesso durante `past_due_pending`. Estado já no enum. UI "aguardar referência Multibanco" com entidade+referência. Job que expira referências não pagas. |
| R-6.3 | **Factura electrónica PT — numeração sequencial sem gaps (obrigação AT).** A AT exige séries sequenciais sem buracos; falhas de geração criam gaps ilegais. | Média | Alto | DP6 decide gerar `invoice_number` via sequência DB transaccional (não Stripe). Sequência por série/ano (`FT 2026/NNNN`). Geração no mesmo commit do `invoice.paid`. Consultar requisitos AT antes de 6.10; possível necessidade de software certificado adiada para Fase 2 se a complexidade o exigir. |
| R-6.4 | **Purge GDPR irreversível — eliminar dados a mais ou cedo demais.** Job de purge a 30d que corre sobre household errado ou antes da janela revogável = perda de dados catastrófica. | Baixa | Crítico | `account_deletion_jobs` com `scheduled_for` + `revoked_at`; job só purga `WHERE scheduled_for <= now() AND revoked_at IS NULL`. Dupla confirmação na UI. Audit log imutável (NFR9). Soft-delete antes do purge real. Teste exaustivo com household sentinela. |
| R-6.5 | **Limite de membros — race condition em convites concorrentes.** Dois convites aceites em simultâneo podem exceder o limite do plano. | Média | Médio | `accept_invite()` é função SQL transaccional com `count(members) < limit` dentro da transação + lock (defesa em profundidade vs UI). Limite enforced em SQL, não só em UI (architecture §5.3). |
| R-6.6 | **Onboarding cria estado inconsistente** se falhar a meio (household criado mas trial não, ou membership em falta). | Média | Alto | 6.1/6.2: criação household + membership owner + subscription trial numa **transação única** (atomicidade). Se o utilizador salta o onboarding, o trial activa-se na mesma (FR31). Idempotência se o utilizador recarregar. |
| R-6.7 | **Stripe keys / payment methods em ambiente de teste vs produção.** MB Way exige activação no Stripe Dashboard (PT region); testar em produção tem custo. | Média | Médio | DevOps configura keys test+prod (handoff). AC4 exige Multibanco+MB Way funcional em **teste e produção**. Smoke test em produção com valor mínimo reembolsável. Documentar setup Stripe PT em runbook. |
| R-6.8 | **`households.plan` denormalizado dessincroniza de `subscriptions.plan`.** Fast-path RLS/quotas lê `households.plan`; se o webhook falha em actualizar ambos, quotas erradas. | Média | Médio | Webhook handler actualiza `subscriptions` + `households.plan` no **mesmo commit**. Job de reconciliação periódico (Inngest) que detecta divergências. Testes do handler asseguram ambos os writes. |
| R-6.9 | **Export GDPR pesado** para households grandes (muitas tarefas/transacções) excede memória/timeout do job. | Baixa | Médio | Job Inngest com streaming para Storage (não montar tudo em memória); paginação por tabela. Signed URL 24h. Métrica de duração do export. |
| R-6.10 | **Custo de manutenção fiscal PT (factura AT, NIF, séries).** Subestimar a complexidade regulatória atrasa o launch. | Média | Médio | Validar requisitos AT cedo (research na 6.10). Se exigir software certificado, isolar numa story dedicada / Fase 2 e lançar com recibo simples + NIF no MVP, sem bloquear o resto do epic. @qa documenta GDPR + revisão fiscal. |

## 7. Dependências Críticas

**Internas (Epics anteriores):**

- **Epic 1 / Story 1.3** (schema multi-tenant + RLS): `households`/`household_members`/`subscriptions` existem; Epic 6 adiciona só `data_export_jobs` + `account_deletion_jobs`.
- **Epic 1 / Story 1.5** (Auth + RLS): `/registar`/`/entrar`/`/recuperar` funcionais; Epic 6 completa o onboarding + branding.
- **Epic 1 / Story 1.7** (Inngest + observability): infra Inngest + Vercel Cron prontos; Epic 6 adiciona jobs de billing/GDPR.
- **Epic 2-4** (módulos): tarefas/finanças existem — necessárias para o tour de onboarding (6.2) e para o export GDPR (6.8) percorrer as tabelas com dados reais.
- **Epic 5** (shell + design system): `<EmptyState>`, `<ChatPanel>`, `WidgetGrid`, slot `HouseholdSwitcher`, `packages/ui` tokens — as páginas novas do Epic 6 (`/conta/plano`, `/conta/faturas`, etc.) reusam estes componentes e tokens.
- **front-end-spec.md** — branding/tokens/microcopy PT-PT para as páginas de plano, faturas, onboarding, convite.

**Externas (acção Eurico/@devops):**

- **@devops configura Stripe** — conta Stripe PT, produtos/prices EUR, activação de **MB Way no Dashboard** (PT region), keys test+prod, webhook endpoint secret. **Bloqueador externo do ramo billing** (Stories 6.3-6.6, 6.10).
- **@devops configura Resend** (se ainda não em produção) — domínio verificado para emails de convite, export, dunning, confirmação.
- **Supabase Storage** (eu-central-1) bucket para exports GDPR — provisionar + política de acesso (signed URLs).
- **Validação Eurico das 8 DPs em §8** antes de `@sm *draft 6.1` (mínimo DP4, DP5, DP6, DP8).
- **Decisão fiscal PT** — confirmar se factura electrónica AT no MVP exige software certificado (R-6.3/R-6.10) ou se recibo+NIF é suficiente para o launch.

**Bloqueadores cross-epic:**

- **Nenhum epic posterior depende do Epic 6 no MVP** — é o último epic da Fase 1. Fecha o roadmap PRD §5.

## 8. Decisões Validadas (Eurico — 2026-05-29)

> **Estado: validadas.** As 8 DPs foram decididas por Eurico em 2026-05-29, desbloqueando o detalhamento das stories. As decisões abaixo são a fonte-de-verdade do âmbito do Epic 6. DP1/DP2/DP3 já estão materializadas (Story 6.1 Done + bootstrap da Story 1.5); DP4-DP8 guiam as stories 6.3-6.10.

| ID | Decisão | Validada | Detalhe e impacto |
| -- | ------- | -------- | ----------------- |
| **DP1** | Verificação de email — Supabase nativo vs custom. | **A — Supabase Auth nativo** | Confirm email nativo (link). Resend reserva-se para emails de produto (convite/export/dunning). **Materializada na Story 6.1** (`emailRedirectTo` + callback + `/confirm`); pré-condição externa: ligar "Confirm email" no Dashboard (follow-up SUPABASE-CONFIRM-EMAIL). |
| **DP2** | Criação do household — registo vs onboarding. | **A — atómica no registo** | household + membership owner criados na transação de registo (R-6.6). **Já satisfeita** pelo trigger `handle_new_user` (Story 1.5 / migr. 0003); a 6.1 verifica+testa. Onboarding (6.2) é puramente tour. |
| **DP3** | Activação de trial — momento e mecanismo. | **A — no registo** | `subscriptions{status:'trialing', trial_ends_at:now+14d}`, plano `familia`, sem Stripe customer (FR33). **Já satisfeita** pelo trigger (1.5); expiry por job `expire-trials` (6.4). |
| **DP4** | Stripe Checkout — hosted vs embedded. | **A — Checkout HOSTED** | Redirect hosted reduz superfície PCI e suporta Multibanco+MB Way nativamente com menos código. Embedded reavalia-se na Fase 2. Guia a Story 6.5. |
| **DP5** | Acesso durante `past_due_pending` (Multibanco 3-7 dias). | **B — manter trial/Free até `invoice.paid`** | Não conceder plano pago sem dinheiro recebido; UI "a aguardar Multibanco". Guia as Stories 6.5/6.3. |
| **DP6** | Numeração de factura AT — sequência própria vs Stripe vs recibo. | **C — recibo + NIF no MVP** | Recibo simples com NIF destrava o launch; certificação AT (sequência sem gaps / software certificado) **adia-se para a Fase 2** (R-6.3/R-6.10). Confirmar requisitos AT antes da 6.10 (follow-up AT-FISCAL-RESEARCH). Guia a Story 6.10. |
| **DP7** | Export GDPR — formato e entrega. | **A — ZIP (JSON+CSV) em Storage + signed URL 24h** | Assíncrono via Inngest aguenta households grandes (R-6.9); coerente com a architecture. Guia a Story 6.8. |
| **DP8** | Household switcher — incluir vs adiar. | **B — adiado para a Fase 2** | Multi-household é caso Pro de nicho; o slot fica desenhado (Epic 5) mas **inactivo no MVP**. Remove o switcher do âmbito do Epic 6 (a linha em §3-IN passa a OUT). |

## 9. Métricas de Sucesso

**Métricas de produto (epic Done quando atingidas — PRD §6 Epic 6):**

- **AC1:** Registo + onboarding completo em < 3 min para utilizador novo.
- **AC2:** Trial activa-se automaticamente; ao fim de 14 dias volta a Free.
- **AC3:** Upgrade Pessoal→Família via Stripe ajusta o limite de membros imediatamente.
- **AC4:** Pagamento via Multibanco e MB Way funcional em ambiente de teste **e produção**.
- **AC5:** Export devolve ZIP com JSON + CSV de toda a data do utilizador.
- **AC6:** Eliminação cria job de purge a 30 dias; revogável até execução.
- **AC7:** Factura emitida tem NIF do cliente quando fornecido.

**Métricas operacionais:**

- Webhook Stripe idempotente — zero duplicação de subscrições em replay de eventos (R-6.1).
- `households.plan` ↔ `subscriptions.plan` sincronizados — zero divergências em reconciliação (R-6.8).
- RLS Coverage Gate verde após criação de `data_export_jobs` + `account_deletion_jobs` (NFR5).
- Cobertura de testes ≥ 70% nos handlers de billing/webhook + jobs Inngest (NFR16).
- Job `gdpr-purge` purga apenas households com `scheduled_for <= now() AND revoked_at IS NULL` — verificado em teste (R-6.4).
- Audit log imutável de `plan_changed`, `account_deleted`, `data_exported` (NFR9).

**Métricas de negócio (medidas após launch — NFR14):**

- **Conversão trial → paid ≥ 8-10%** (project-brief §pricing; OKR KR2).
- % de checkouts via Multibanco/MB Way vs cartão — valida a tese de payment methods PT.
- % de households que convidam ≥ 1 membro (proxy de adopção do tier Família).
- Churn mensal < target (NFR14 dashboard).
- Tempo médio registo → primeiro upgrade.

## 10. FRs/NFRs Cobertos

**Functional Requirements (do PRD §2.1):**

- **FR24** — Registo com email+password, confirmar email, completar onboarding.
- **FR25** — Cada utilizador pertence a 1+ households conforme limite de plano.
- **FR26** — Toda a data tem `household_id` + RLS cross-household (mantido nas tabelas novas).
- **FR27** — Owner convida membros via email (limites Pessoal=1/Família=4/Pro=10).
- **FR28** — Export completo JSON+CSV a qualquer momento (GDPR Art. 20).
- **FR29** — Eliminação completa com purge real a 30 dias (GDPR Art. 17).
- **FR30** — Onboarding cria household default + tour 3 passos + trial 14d automático.
- **FR31** — Onboarding saltável; trial activa sempre.
- **FR32** — Stripe: checkout, subscrições, mudança de plano pró-rata, cancelamentos, faturas.
- **FR33** — Trial 14d sem cartão; regride a Free ao terminar.
- **FR34** — Mudança entre Free/Pessoal €4,90/Família €8,88/Pro €14,90 a qualquer momento.
- **FR35** — Factura/recibo electrónico AT-compatível com NIF, disponível no painel.
- **FR36** — Checkout com cartão + Multibanco + MB Way.

**Non-Functional Requirements (do PRD §2.2):**

- **NFR5** — RLS Postgres nas tabelas novas (`data_export_jobs`, `account_deletion_jobs`) — gate CI obrigatório.
- **NFR6** — Hashing bcrypt cost 12 (Supabase Auth nativo).
- **NFR9** — Audit log imutável de login, mudança de plano, export, eliminação (12 meses).
- **NFR10** — GDPR: acesso, portabilidade (FR28), eliminação (FR29), rectificação.
- **NFR14** — Dashboards de conversões trial→paid + churn.
- **NFR16** — Cobertura ≥ 70% nos módulos de billing/GDPR.
- **NFR19** — Imports absolutos `@/...` e `@meu-jarvis/...`.

**Constraints (do PRD §2.3):**

- **CON3** — PT-PT exclusivo (copy de onboarding, planos, faturas, convites, emails).
- **CON8** — Cada story validada por @po antes de @dev implementar.
- **CON9** — EUR único (check constraints já em `subscriptions`/`invoices`/`households`).

## Change Log

| Versão | Data | Autor | Mudanças |
| ------ | ---- | ----- | -------- |
| v0.1 | 2026-05-29 | Morgan (@pm) | Draft inicial — skeleton + 10 stories alta-nível (6.1-6.10 alinhadas com PRD §6) + 10 riscos macro + 8 DPs pendentes. Âmbito ancorado no codebase real verificado: schema de billing/tenancy/GDPR **já existe** (`billing.ts`, `tenancy.ts`, `audit.ts`); trabalho do epic é fluxo+integração Stripe+UI+jobs Inngest. 2 tabelas novas identificadas (`data_export_jobs`, `account_deletion_jobs`). Modelo Stripe + convites + GDPR já especificados na architecture §5.3/§6. Pré-condição: Epic 5 9/10 Done (shell + design system entregues). Bloqueador externo principal: @devops configura Stripe (keys, produtos/prices, MB Way no Dashboard PT). **Pendente: validação das 8 DPs por Eurico antes de `@sm *draft 6.1`** (mínimo DP4 checkout, DP5 Multibanco access, DP6 factura AT, DP8 switcher). |
| v1.0 | 2026-05-29 | Morgan (@pm) | **Epic validado (v1.0 Validated).** 8 DPs decididas por Eurico → §8 passa de "pendentes" para "validadas" (fonte-de-verdade do âmbito): DP1=A Supabase nativo · DP2=A household atómico (feito 1.5) · DP3=A trial no registo (feito 1.5) · DP4=A Stripe HOSTED · DP5=B manter trial/Free até `invoice.paid` · DP6=C recibo+NIF no MVP (certificação AT→Fase 2) · DP7=A ZIP+signed URL · DP8=B switcher adiado→Fase 2. **Switcher removido do §3-IN** (DP8). §5: 6.1 marcada **Done** (gate PASS 9,3/10, em produção) — Epic 6 = **1/10 Done**. 6.10 ajustada para recibo+NIF (DP6=C). Detalhamento das restantes stories desbloqueado. Próximas prioritárias: 6.3 (Stripe — gargalo) e 6.2 (onboarding). |

---

*Documento de planeamento por Morgan (@pm AIOX) em 2026-05-29. Pré-condições de detalhamento de stories:*
*1) Epics 1-4 Done; Epic 5 9/10 Done (shell + design system entregues — verificado).*
*2) Schema de billing/tenancy/GDPR existente verificado byte-a-byte em `packages/db/src/schema/`.*
*3) Modelo Stripe + convites + GDPR especificados em `docs/architecture.md §5.3/§6`.*
*Estado: v1.0 Validated (8 DPs decididas 2026-05-29). 6.1 Done. Próximo passo: `@sm *draft 6.3` (Stripe — gargalo, requer STRIPE-SETUP do @devops) ou `@sm *draft 6.2` (onboarding).*

*Toda decisão técnica é rastreável a FR/NFR/CON do PRD, à architecture.md ou ao schema/codebase real verificado, conforme Constitution Article IV — No Invention.*
