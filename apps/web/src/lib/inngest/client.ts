/**
 * Inngest client — instância partilhada da app `expressia-web`.
 *
 * Story 2.8 AC1 — primeira utilização de Inngest no projecto. O SDK lê
 * automaticamente as variáveis de ambiente `INNGEST_EVENT_KEY` e
 * `INNGEST_SIGNING_KEY` (vazias em dev local — usar `npx inngest-cli dev` para
 * engine local; em prod Vercel as keys são populadas pelo runbook
 * `docs/runbooks/inngest-setup.md`).
 *
 * Isolation entre dev/prod faz-se via workspaces Inngest distintos (dev e
 * production têm event keys separadas — o mesmo `id: 'expressia-web'` é
 * usado, mas o dashboard separa pelos eventos recebidos).
 *
 * Trace: Architecture §11.3 (Inngest provider), ADR-005 §14.5 (Inngest EU),
 *        Story 2.8 D38 (cron Inngest nativo) + D39 (inline em apps/web/src/lib).
 */
import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'expressia-web',
  name: 'Expressia Web',
});
