# Avaliação — rate-limiting na autenticação (pré-soft-launch)

| Campo | Valor |
|-------|-------|
| Autor | @aiox-master (Orion) |
| Data | 15/06/2026 |
| Pedido por | Follow-up [AGENTE] do handoff `mj-handoff-followups-soft-launch-20260615` |
| Pergunta | Os limites nativos do Supabase GoTrue chegam antes de abrir amplamente? |
| Veredicto | **SUFICIENTE para o soft-launch** (audiência pequena), com 1 ação de config + 2 follow-ups antes de abertura ampla |

---

## 1. Superfície de auth e quem a protege hoje

Os Server Actions de auth (`apps/web/src/app/(auth)/actions.ts`) chamam o
Supabase GoTrue diretamente:

| Ação | Endpoint GoTrue | Proteção atual |
|------|-----------------|----------------|
| `signInAction` | `signInWithPassword` | rate-limit nativo GoTrue (por IP) + anti-enumeration na app (`mapSignInError` colapsa erros) |
| `signUpAction` | `signUp` | rate-limit nativo GoTrue + envio de email (GAP-2) |
| `resetPasswordAction` | `resetPasswordForEmail` | rate-limit nativo GoTrue + anti-enumeration (resposta neutra sempre) |

**Não há throttle app-level nestes endpoints.** O rate-limiter do projeto
(`apps/web/src/lib/agent/rate-limiter.ts`, sobre Upstash Redis) cobre **quotas de
prompts AI**, não a auth. A auth depende inteiramente dos limites do GoTrue.

## 2. Limites nativos do GoTrue (Supabase)

O GoTrue aplica rate-limits configuráveis no Dashboard → Authentication → Rate
Limits, incluindo (defaults na ordem de grandeza, **confirmar no Dashboard do
projeto**):

- **Envio de email** (signup confirm, reset, magic link) — o limite mais
  restritivo e o que mais afeta o registo. Com o SMTP **default** do Supabase é
  muito baixo (~poucos emails/hora) e bloqueia domínios — ver GAP-2.
- **Verificação de token / OTP** — limite por IP.
- **Tentativas de sign-in** — limite por IP (mitiga brute-force básico).

Estes limites são **por projeto** e suficientes para travar abuso casual e
brute-force ingénuo numa audiência de soft-launch.

## 3. Conclusão para o soft-launch

Para uma audiência pequena e controlada, os limites do GoTrue **chegam**. O risco
real não é falta de rate-limit em sign-in (o GoTrue cobre) — é o **envio de
email** (GAP-2): com o SMTP default, o registo a estranhos parte por rate-limit
de email, não por segurança.

### Ação de configuração (Eurico) — já no caminho crítico

- **Resolver GAP-2**: ligar **Resend SMTP** custom (recomendado) OU desligar
  "Confirm email" no soft-launch. Sem isto o registo falha por rate-limit de
  email do SMTP partilhado. (Já catalogado no handoff de follow-ups.)
- **Verificar** os valores em Dashboard → Authentication → Rate Limits e
  confirmar que não foram afrouxados de mais.

## 4. Follow-ups antes de abertura ampla (não soft-launch)

- **Throttle app-level em `signUp`/`resetPassword`** sobre o Upstash já existente
  (chave por IP + por email), como defesa-em-profundidade independente do GoTrue
  — útil se aparecer abuso (spam de reset, enumeração distribuída por IPs).
  Reaproveita o cliente Upstash de `rate-limiter.ts`.
- **CAPTCHA/Turnstile** no signup se houver registo automatizado abusivo (o
  Supabase suporta hCaptcha/Turnstile nativo — toggle no Dashboard).

Nenhum destes é bloqueante do soft-launch; são gatilhos a accionar conforme o
tráfego real.
