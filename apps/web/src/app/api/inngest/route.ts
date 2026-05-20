/**
 * GET/POST/PUT /api/inngest — endpoint público Inngest.
 *
 * Story 2.8 AC3 — expõe as funções Inngest da app via o helper `serve` de
 * `inngest/next`. Endpoint é PÚBLICO (não auth via Supabase): a autenticação
 * é feita pelo SDK Inngest validando a header `X-Inngest-Signature` contra
 * `INNGEST_SIGNING_KEY` (env var populada pelo runbook em prod).
 *
 * **IMPORTANTE (DN3):** Este endpoint NÃO deve ser adicionado ao
 * `APP_PATH_PREFIXES` em `src/middleware.ts` — é público por design (Inngest
 * Cloud chama o endpoint para registar funções e despachar invocações).
 *
 * Methods:
 *   - GET  → introspecção (Inngest lista funções registadas)
 *   - POST → invocação de função (cron tick ou event despachado)
 *   - PUT  → sync / registo das funções no workspace Inngest
 *
 * Trace: Inngest Next.js quickstart docs, Story 2.8 AC3 + DN3.
 */
import { serve } from 'inngest/next';

import { inngest } from '@/lib/inngest/client';
import { cleanupExpiredReverseOps } from '@/lib/inngest/functions/cleanup-expired-reverse-ops';
import { generateRecurringTasks } from '@/lib/inngest/functions/generate-recurring-tasks';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [cleanupExpiredReverseOps, generateRecurringTasks],
});
