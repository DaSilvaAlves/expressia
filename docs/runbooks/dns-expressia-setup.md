# Runbook — DNS de expressia.pt (Cloudflare + Vercel)

> Carry-over **DNS-001**. Criado em 20/05/2026 por @devops (Gage).

## Contexto

`expressia.pt` é um domínio **guarda-chuva partilhado**. Os nameservers estão
delegados ao **Cloudflare** (`howard.ns.cloudflare.com` / `vera.ns.cloudflare.com`)
e o DNS é gerido no painel Cloudflare. Vários projectos do ecossistema
IA AVANÇADA PT usam subdomínios deste domínio.

O SaaS **Expressia** (repo `meu-jarvis`, projecto Vercel `expressia`) vive em
`expressia-black.vercel.app`. Em 20/05/2026 o domínio apex `expressia.pt` foi
atribuído ao projecto Vercel `expressia` via `vercel domains add expressia.pt`.
Falta criar o registo DNS no Cloudflare para o domínio começar a servir o SaaS —
acção **pendente da decisão do destino** (apex vs subdomínio).

## REGRA CRÍTICA — nameservers

**NUNCA mudar os nameservers de `expressia.pt` para `ns1/ns2.vercel-dns.com`.**

O Cloudflare é a fonte de verdade do DNS e serve 6+ subdomínios de outros
projectos da imersão. Mudar os nameservers para a Vercel destruiria o DNS de
todos eles.

A Vercel sugere essa hipótese (opção "b") no aviso *"not configured properly"* —
**ignorar sempre a opção (b)**. Usar sempre a opção (a): registo A/CNAME no
Cloudflare, mantendo o Cloudflare como DNS.

## Estado actual (20/05/2026)

| Item | Estado |
|------|--------|
| Nameservers | Cloudflare (`howard`/`vera.ns.cloudflare.com`) |
| Apex `expressia.pt` | Sem registo A — não serve nada |
| `www.expressia.pt` | Não existe |
| Atribuição Vercel | `expressia.pt` → projecto `expressia` (feito 20/05/2026) |
| Verificação Vercel | Pendente — falta registo A no Cloudflare |

Subdomínios já em produção (**não tocar**): `imersao.ia`, `iaavancada`,
`comunidade.avancada`, `prompt-optimizer`, `starter-builder`,
`briefing-generator`, `aios-compiler` — todos em `*.expressia.pt`.

## Activação — passo-a-passo no painel Cloudflare

Executar **após confirmar o destino** do domínio.

### Cenário A — apex + www servem o SaaS

1. Cloudflare → `dash.cloudflare.com` → zona `expressia.pt` → DNS → Records.
2. Add record (apex):
   - Type: `A`
   - Name: `@` (representa o apex `expressia.pt`)
   - IPv4 address: `76.76.21.21`
   - Proxy status: **DNS only** (nuvem cinzenta — **NÃO** laranja). A Vercel gere
     o próprio CDN/SSL; o proxy Cloudflare por cima causa conflito de certificado.
   - TTL: Auto
3. Add record (www):
   - Type: `CNAME`
   - Name: `www`
   - Target: `cname.vercel-dns.com`
   - Proxy status: **DNS only**
   - TTL: Auto
4. Aguardar propagação (minutos a ~1h). A Vercel corre verificação automática e
   envia email ao concluir.
5. Confirmar: `vercel domains inspect expressia.pt` → sem `WARNING`.

### Cenário B — só um subdomínio serve o SaaS

1. Na Vercel: `vercel domains rm expressia.pt` (remover o apex do projecto) e
   atribuir o subdomínio escolhido — ex.: `vercel domains add app.expressia.pt`.
2. Cloudflare → Add record:
   - Type: `CNAME`
   - Name: `app` (ou o subdomínio escolhido)
   - Target: `cname.vercel-dns.com`
   - Proxy status: **DNS only**
3. Verificação como no Cenário A.

## Verificação

```bash
vercel domains inspect expressia.pt   # sem WARNING quando OK
nslookup -type=A expressia.pt         # deve devolver 76.76.21.21 (Cenário A)
```

## Reversão

A atribuição Vercel é reversível sem impacto: `vercel domains rm expressia.pt`.
Enquanto não houver registo A/CNAME no Cloudflare, o apex não serve nada —
**zero impacto em produção** e zero efeito sobre os subdomínios da imersão.
