# Runbook — Smoke E2E do ciclo de convite de membro household

**Story de origem:** `docs/stories/active/INVITE-E2E.smoke-ciclo-convite-household.story.md`
**Trace:** Story 6.7 (FR27, D-6.7.2 email-match, R-6.5 limite de plano); migration `0022_accept_invite_user_param.sql`; catálogo soft-launch `mj-handoff-followups-soft-launch-20260615.yaml` §INVITE-E2E-SMOKE; Constitution Article IV (evidência real — zero invenção).

Este runbook documenta o procedimento reproduzível para validar, com sessões reais no browser, o ciclo completo de convite de membro de uma família (household) na Expressia: criar convite → copiar link → convidado autentica → aceita → membership visível → owner remove membro. A feature está **implementada e versionada** (Story 6.7, mergida); este runbook fecha apenas o gap de validação E2E.

> **Estado da execução:** o procedimento abaixo (secções 1–6) é o entregável autónomo do @dev. A **execução real** (preenchimento da tabela de evidência da secção 7) é **deferida ao Eurico** — requer 2 contas com sessões Supabase reais no browser, que um agente headless não consegue autenticar de forma fiável (cookie SSR httpOnly não extraível, sem Playwright aprovado no projecto). Precedente: Story OBS-3 (medição Lighthouse autenticada) e Story 6.8 (upload bucket E2E). NÃO preencher a tabela de evidência sem screenshots reais (Constitution Article IV).

---

## 1. Pré-condições

### 1.1 Duas contas distintas em produção

| Conta | Papel no smoke | Requisito |
|-------|----------------|-----------|
| **Conta A** | Owner / anfitriã | Conta registada; **plano `familia`** (limite 4 membros). Será quem convida. |
| **Conta B** | Convidada | Conta registada com **email diferente** da Conta A. Será quem aceita. |

> **Porquê plano `familia`:** o plano por defeito no signup é `free`, cujo limite é **1 membro** (apenas o próprio owner). Com `free`/`pessoal` a aceitação falha sempre com `MEMBER_LIMIT_REACHED`. O plano `familia` permite **4 membros** (limites confirmados em `migration 0022_accept_invite_user_param.sql:125-130` e enum `plan_tier` em `0000_initial_schema.sql:108`: `free=1`, `pessoal=1`, `familia=4`, `pro=10`).

### 1.2 Promover a Conta A para o plano `familia`

Não existe UI de upgrade (billing congelado no MVP). A promoção é manual, via Supabase Dashboard ou `getServiceDb()` (role `service_role`, ignora RLS — uso admin legítimo). Atualizar a coluna `households.plan` do household da Conta A:

```sql
-- Substituir <household_id_da_conta_A> pelo UUID do household da Conta A.
update public.households
set plan = 'familia'
where id = '<household_id_da_conta_A>';
```

Para descobrir o `household_id` da Conta A: na app, a Conta A em `/conta/household` mostra a família; em alternativa, consultar `household_members` filtrando por `user_id` da Conta A (via Supabase Dashboard → Table editor).

**Checkpoint pré-condição:** após a promoção, a Conta A em `/conta/household` deve mostrar o badge de plano **"Família"** (label PT-PT de `familia`, ver `household-editor.tsx:32-37`).

### 1.3 URLs de produção

| Preferência | URL |
|-------------|-----|
| Preferida (se DNS-001 activo) | `https://expressia.pt` |
| Fallback | `https://expressia-black.vercel.app` |

### 1.4 Sessões em browsers/perfis separados

As duas contas têm de estar em sessões Supabase distintas (cookies `sb-*` httpOnly geridos por `@supabase/ssr`). Recomendado:

- 2 browsers diferentes (ex.: Chrome para a Conta A + Firefox para a Conta B), **ou**
- Chrome normal (Conta A) + janela privada/anónima (Conta B).

Não usar duas abas do mesmo perfil — partilham a mesma sessão.

---

## 2. Ciclo completo (P1 → P8)

> Cada passo indica a UI/endpoint exacto e o checkpoint de verificação (o que confirma o sucesso). Tirar screenshot de cada checkpoint para a tabela da secção 7.

### P1 — Conta A cria o convite

1. **Conta A** acede a `/conta/household`.
2. Na secção **"Convidar para a família"** (só visível a `owner`/`admin`), preencher o campo de email com o **email da Conta B** e selecionar o papel **"Membro"** (`member`) no seletor.
3. Clicar **"Convidar"**.

- **UI:** `apps/web/src/app/(app)/conta/household/_components/household-editor.tsx` (secção "Convidar para a família").
- **Endpoint:** `POST /api/conta/household/invites` → body `{ email, role: "member" }`. Resposta `201` com `{ invite, acceptPath: "/aceitar-convite/{token}" }`.
- **Checkpoint P1:** o botão mostra brevemente "A convidar…" e, em sucesso, **aparece a caixa "Link de convite — copia e envia à pessoa:"** com um campo de texto preenchido (URL completa). O convite expira em 7 dias (texto visível: "O convite expira em 7 dias.").

### P2 — Conta A copia o link de convite

1. Na caixa "Link de convite", o campo de texto contém o URL completo no formato `{origin}/aceitar-convite/{token}` (ex.: `https://expressia.pt/aceitar-convite/ab12…`). O `token` é hex de 32 bytes.
2. Clicar no campo (auto-seleciona o texto — `onFocus` faz `select()`) e copiar.
3. Em paralelo, o convite aparece na lista de **convites pendentes** abaixo, com o email da Conta B + "Membro · pendente" e um botão **"Revogar"**.

- **UI:** o link é construído no cliente como `${window.location.origin}${data.acceptPath}` (`household-editor.tsx:145`). A lista de pendentes é recarregada via `GET /api/conta/household/invites` (o `token` NUNCA é exposto na listagem — só no link gerado no momento da criação).
- **Checkpoint P2:** o link tem o formato `/aceitar-convite/{token}` e o convite consta da lista de pendentes ("{email} · Membro · pendente").

### P3 — Conta B abre o link (sessão distinta)

1. **Conta B** (browser/perfil distinto) cola e abre o URL `/aceitar-convite/{token}`.

- **UI:** `apps/web/src/app/aceitar-convite/[token]/page.tsx` (Server Component, fora dos grupos `(app)`/`(auth)`).
- **Checkpoint P3:** ver P4 (o comportamento depende do estado de autenticação da Conta B).

### P4 — Redirect para login (se Conta B não autenticada)

1. Se a Conta B **não tem sessão activa**, a RSC redireciona automaticamente para a página de login, preservando o retorno.

- **Comportamento:** `page.tsx:35-37` — `supabase.auth.getUser()` sem `user` → `redirect('/entrar?next=' + encodeURIComponent('/aceitar-convite/{token}'))`.
- **Checkpoint P4:** o URL muda para `/entrar?next=%2Faceitar-convite%2F{token}` (o `next` é URL-encoded) e é mostrada a página de login.

> Se a Conta B já estiver autenticada quando abre o link, este passo é saltado e segue direto para P6 (página de aceitação).

### P5 — Conta B autentica e regressa ao convite

1. A Conta B inicia sessão na página `/entrar` com as suas credenciais.
2. Após login bem-sucedido, é reencaminhada de volta para `/aceitar-convite/{token}` (graças ao parâmetro `next`).

- **Checkpoint P5:** após o login, o URL volta a `/aceitar-convite/{token}` e a Conta B vê a página de aceitação (ver P6).

### P6 — Conta B aceita o convite

1. A página mostra o título **"Convite para uma família"** + texto descritivo + botão **"Aceitar convite"**.
2. A Conta B clica **"Aceitar convite"**.

- **UI:** `apps/web/src/app/aceitar-convite/[token]/_components/aceitar-convite.tsx` (Client Component).
- **Endpoint:** `POST /api/conta/household/aceitar-convite` → body `{ token }`. O handler chama a função SQL `accept_invite(token, user.id)` (SECURITY DEFINER, migration 0022): valida estado/expiração/email-match/limite de plano/já-membro e cria a membership atomicamente.
- **Checkpoint P6:** o botão mostra "A aceitar…" e, em sucesso, surge a mensagem **"Convite aceite. A levar-te para a tua família…"** (role `status`), seguida de redirect automático para `/conta/household`.

### P7 — Conta A vê a Conta B na lista de membros

1. **Conta A** recarrega `/conta/household` (ou actualiza a página).
2. A Conta B passa a constar da secção **"Membros"** com o papel **"Membro"** (badge de role).

- **UI:** secção "Membros" do `household-editor.tsx` (`GET /api/conta/household` devolve a lista de membros com role).
- **Checkpoint P7:** a Conta B aparece na lista de membros com o badge "Membro" e o contador de membros incrementa (ex.: "Membros (2)"). O convite correspondente **desaparece** da lista de pendentes (foi marcado `accepted_at`).

> **Nota multi-household (verificar e registar — ver secção 6):** a Conta B continua a ver o **seu próprio** household original em `/conta/household` (mostra o household do JWT, não o novo). Isto é comportamento documentado, não um bug.

### P8 — (Opcional) Conta A remove a Conta B

1. **Conta A** em `/conta/household`, na linha da Conta B, clica **"Remover"**.
2. Confirma o diálogo do browser ("Remover {nome} desta família?").

- **UI:** botão "Remover" (só visível a `owner`/`admin`, e nunca aparece na linha do owner — `household-editor.tsx:253` `canRemove`).
- **Endpoint:** `DELETE /api/conta/household/members/{userId}`. Resposta `200` com `{ removed: true, userId }`.
- **Checkpoint P8:** a Conta B desaparece da lista de membros e o contador volta a decrementar (ex.: "Membros (1)").

---

## 3. Caminhos de erro (verificar pelo menos 1)

> Mensagens PT-PT confirmadas em `apps/web/src/app/api/conta/household/aceitar-convite/route.ts` (`mapAcceptInviteError`) e em `members/[userId]/route.ts`.

### 3.1 Convite expirado (> 7 dias)

- **Como reproduzir:** aceitar um convite cujo `expires_at` já passou. Para testar sem esperar 7 dias, antecipar a expiração via SQL admin:
  ```sql
  update public.household_invites
  set expires_at = now() - interval '1 minute'
  where token = '<token_do_convite>';
  ```
- **Erro SQL subjacente:** `INVITE_EXPIRED` (`accept_invite` linha 91-92).
- **Comportamento esperado na UI (Conta B clica "Aceitar convite"):** mensagem de erro **"Este convite expirou. Pede um novo à tua família."** (HTTP 410).

### 3.2 Email mismatch (Conta B com email diferente do convite)

- **Como reproduzir:** convidar `emailX@exemplo.pt` mas a Conta B autenticada tem email diferente; a Conta B abre o link e clica "Aceitar convite".
- **Erro SQL subjacente:** `INVITE_EMAIL_MISMATCH` (`accept_invite` linha 106-108; comparação case- e whitespace-insensitive).
- **Comportamento esperado na UI:** mensagem de erro **"Este convite foi enviado para outro email. Entra com a conta certa."** (HTTP 403).

### 3.3 Convite revogado antes de ser aceite

- **Como reproduzir:** a Conta A cria o convite (P1), depois clica **"Revogar"** na lista de pendentes (`DELETE /api/conta/household/invites/{id}`) ANTES de a Conta B aceitar. A Conta B abre o link e clica "Aceitar convite".
- **Erro SQL subjacente:** `INVITE_NOT_FOUND` — a revogação elimina a row do convite, logo o token deixa de existir (`accept_invite` linha 83-84).
- **Comportamento esperado na UI:** mensagem de erro **"Convite inválido ou inexistente."** (HTTP 404).

### 3.4 Mapa completo de erros (referência)

| Erro SQL | Causa | Mensagem UI (PT-PT) | HTTP |
|----------|-------|---------------------|------|
| `INVITE_NOT_FOUND` | Token inválido/adulterado OU convite revogado | "Convite inválido ou inexistente." | 404 |
| `INVITE_EXPIRED` | `expires_at <= now()` (> 7 dias) | "Este convite expirou. Pede um novo à tua família." | 410 |
| `INVITE_ALREADY_ACCEPTED` | Token já aceite | "Este convite já foi aceite." | 409 |
| `INVITE_EMAIL_MISMATCH` | Email da Conta B ≠ email do convite | "Este convite foi enviado para outro email. Entra com a conta certa." | 403 |
| `ALREADY_MEMBER` | Conta B já é membro do household | "Já fazes parte desta família." | 409 |
| `MEMBER_LIMIT_REACHED` | Household atingiu o limite do plano | "Esta família já atingiu o limite de membros do plano." | 409 |
| `AUTH_REQUIRED` | Sessão inválida | "Sessão inválida. Inicia sessão novamente." | 401 |
| `OWNER_NOT_REMOVABLE` | Tentativa de remover o owner (P8) | "O dono da família não pode ser removido." | 422 |

---

## 4. Resumo de paths (referência rápida)

| Passo | UI | Endpoint |
|-------|-----|----------|
| P1 criar convite | `/conta/household` → "Convidar para a família" | `POST /api/conta/household/invites` |
| P2 copiar link | caixa "Link de convite" | (resposta de P1: `acceptPath`) |
| P3-P6 aceitar | `/aceitar-convite/{token}` | `POST /api/conta/household/aceitar-convite` |
| P4 redirect login | `/entrar?next=/aceitar-convite/{token}` | (redirect RSC) |
| P7 ver membro | `/conta/household` → "Membros" | `GET /api/conta/household` |
| P8 remover membro | `/conta/household` → botão "Remover" | `DELETE /api/conta/household/members/{userId}` |
| (revogar) | `/conta/household` → botão "Revogar" | `DELETE /api/conta/household/invites/{id}` |

---

## 5. Auditoria (NFR9)

O ciclo gera entradas em `audit_log` (verificável via Supabase Dashboard, opcional):

- P1 → `household_invite_sent`
- P6 → `household_invite_accepted`
- P8 → `household_member_removed`
- (revogar) → `household_invite_revoked`

---

## 6. Nota de design — comportamento multi-household

Todo o signup cria automaticamente um household próprio (trigger `handle_new_user`). Aceitar um convite **adiciona** uma membership nova **sem remover** a existente — a Conta B fica em **dois households**. O `/conta/household` mostra o household do **JWT** (o household original da Conta B, não o novo).

Isto **NÃO é um bug** — é comportamento documentado na migration 0022 (nota de design; tratamento do household activo é follow-up de produto). O smoke deve **verificar e registar** este comportamento para informar o produto: depois de P6, a Conta B deve continuar a ver o seu household original em `/conta/household`.

---

## 7. Tabela de evidência [A PREENCHER PELO EURICO]

> **Instruções:** executar P1→P8 em produção com 2 contas reais e, para cada checkpoint, anexar screenshot, registar a data/hora (DD/MM/YYYY HH:MM) e o resultado (PASS/FAIL). NÃO preencher sem evidência real (Constitution Article IV). Testar pelo menos 1 cenário de erro da secção 3.

| Checkpoint | Esperado | Screenshot | Data/Hora | Resultado |
|------------|----------|------------|-----------|-----------|
| Pré-cond. plano | Conta A mostra badge "Família" | _( )_ | _( )_ | _( )_ |
| P1 criar convite | Caixa "Link de convite" aparece | _( )_ | _( )_ | _( )_ |
| P2 copiar link | Link `/aceitar-convite/{token}` + convite pendente listado | _( )_ | _( )_ | _( )_ |
| P3-P4 abrir link s/ sessão | Redirect para `/entrar?next=…` | _( )_ | _( )_ | _( )_ |
| P5 login + retorno | Volta a `/aceitar-convite/{token}` | _( )_ | _( )_ | _( )_ |
| P6 aceitar | "Convite aceite. A levar-te para a tua família…" + redirect | _( )_ | _( )_ | _( )_ |
| P7 membro visível | Conta B na lista de membros (role "Membro"), contador +1 | _( )_ | _( )_ | _( )_ |
| P7 multi-household | Conta B ainda vê o seu household original | _( )_ | _( )_ | _( )_ |
| P8 remover (opc.) | Conta B desaparece da lista, contador −1 | _( )_ | _( )_ | _( )_ |
| Erro: expirado | "Este convite expirou. Pede um novo à tua família." | _( )_ | _( )_ | _( )_ |
| Erro: email mismatch | "Este convite foi enviado para outro email…" | _( )_ | _( )_ | _( )_ |
| Erro: revogado | "Convite inválido ou inexistente." | _( )_ | _( )_ | _( )_ |

**Conclusão do smoke (a preencher pelo Eurico):** _( PASS / FAIL — data + observações )_

---

## 8. Referências

- `apps/web/src/app/(app)/conta/household/page.tsx` + `_components/household-editor.tsx` — UI de gestão.
- `apps/web/src/app/aceitar-convite/[token]/page.tsx` + `_components/aceitar-convite.tsx` — UI de aceitação.
- `apps/web/src/app/api/conta/household/invites/route.ts` — criar/listar convite.
- `apps/web/src/app/api/conta/household/invites/[id]/route.ts` — revogar convite.
- `apps/web/src/app/api/conta/household/aceitar-convite/route.ts` — aceitar convite (+ `mapAcceptInviteError`).
- `apps/web/src/app/api/conta/household/members/[userId]/route.ts` — remover membro.
- `packages/db/migrations/0022_accept_invite_user_param.sql` — função SQL `accept_invite` + nota de design multi-household + limites de plano.
- `packages/db/migrations/0000_initial_schema.sql:108` — enum `plan_tier`.
- `docs/stories/active/INVITE-E2E.smoke-ciclo-convite-household.story.md` — story de origem.
