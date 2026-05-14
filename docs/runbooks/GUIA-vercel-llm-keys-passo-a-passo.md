# Guia Passo a Passo — Adicionar as API Keys LLM no Vercel

> Guia para o dono do projecto seguir **agora**, com o dashboard Vercel aberto.
> Runbook técnico completo: `docs/runbooks/vercel-llm-keys-setup.md`.
> Estima: ~3 minutos.

---

## Antes de começar — o que precisas à mão

Os dois valores das tuas API keys. Se não os tens à mão:

| Key | Onde obter |
|-----|------------|
| `OPENAI_API_KEY` | platform.openai.com → Settings → API keys → "Create new secret key" (começa por `sk-...`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys → "Create Key" (começa por `sk-ant-...`) |

⚠️ A OpenAI só mostra a key **uma vez** no momento da criação — copia logo. Se a perdeste, cria uma nova.

---

## Passo 1 — Abrir a página certa

Abre este link directo no browser (já estás autenticado como `euricojsalves-4744`):

```
https://vercel.com/euricojsalves-4744s-projects/expressia/settings/environment-variables
```

**Se o link não abrir directo:**
1. vercel.com → entra
2. Clica no projecto **expressia**
3. Tab **Settings** (barra de topo)
4. No menu lateral esquerdo, clica **Environment Variables**

Deves ver uma lista com 13 variáveis já lá (Supabase, Sentry, etc.).

---

## Passo 2 — Adicionar `OPENAI_API_KEY`

Na zona de adicionar variável (botão **Add** / **Add New** / formulário no topo):

| Campo | O que pôr |
|-------|-----------|
| **Key** (ou "Name") | `OPENAI_API_KEY` — escrito exactamente assim, maiúsculas |
| **Value** | colar o valor da tua key OpenAI (`sk-...`) |
| **Environments** | marcar ✅ **Production** e ✅ **Preview** — deixar **Development** desmarcado |
| **Sensitive** (se aparecer) | ✅ activar — esconde o valor depois de gravado (boa prática para secrets) |

Clica **Save** (ou **Add**).

---

## Passo 3 — Adicionar `ANTHROPIC_API_KEY`

Repete exactamente o mesmo do Passo 2, mas:

| Campo | O que pôr |
|-------|-----------|
| **Key** | `ANTHROPIC_API_KEY` |
| **Value** | colar o valor da tua key Anthropic (`sk-ant-...`) |
| **Environments** | ✅ **Production** + ✅ **Preview** |
| **Sensitive** | ✅ activar |

Clica **Save**.

---

## Passo 4 — Confirmar (checklist)

Olha para a lista de Environment Variables e confirma:

- [ ] A lista tem agora **15 variáveis** (13 + 2 novas)
- [ ] `OPENAI_API_KEY` aparece, com Environments = `Production, Preview`
- [ ] `ANTHROPIC_API_KEY` aparece, com Environments = `Production, Preview`

---

## O que **NÃO** fazer

- ❌ **Não cliques em "Redeploy"** — mesmo que o Vercel mostre um banner a sugerir. O redeploy faço-o eu (@devops) de forma controlada, sobre o deployment de produção actual, sem código novo.
- ❌ Não marques **Development** nos environments — não é preciso.
- ❌ Não coles as keys em mais lado nenhum (chat, ficheiros do repo, commits).

---

## A seguir

Quando os Passos 2 e 3 estiverem feitos e o Passo 4 confirmado, volta aqui e diz **"feito"**.

Eu (@devops) assumo a partir daí:
1. `vercel env ls` — confirmo que as 2 keys aparecem em Production + Preview
2. `vercel redeploy` — redeploy do deployment de produção (re-build com as env vars novas, mesmo código)
3. Espero o deploy ficar `Ready` em `fra1` (Frankfurt)
4. Valido o `/jarvis` — um prompt "olá" tem de correr sem `401`
5. Actualizo o runbook de tracking + crio o handoff para `@dev` implementar a spec de erro
