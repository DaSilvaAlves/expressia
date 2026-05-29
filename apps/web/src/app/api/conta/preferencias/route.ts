/**
 * GET / PATCH /api/conta/preferencias — preferências do utilizador.
 *
 * Story 2.7 (FR4) introduziu o toggle `always_preview`. **Story 5.7 (FR21)**
 * estende este endpoint para `widgets_enabled` (config de widgets da Visão),
 * reutilizando `PreferencesPatchSchema` (Story 5.1 — campos opcionais).
 *
 * GET:
 *   - Lazy-init UPSERT (D32): `INSERT ... ON CONFLICT (user_id) DO NOTHING`
 *     resolve household via `household_members` (primeiro household do user);
 *     depois SELECT. Idempotente — concurrent GETs não duplicam rows.
 *   - Retorna `{ always_preview, widgets_enabled, theme }` (Story 5.8 AC4).
 *     `widgets_enabled` validado com `WidgetsEnabledSchema.safeParse` + fallback
 *     `DEFAULT_WIDGETS_ENABLED`; `theme` com `ThemeSchema.safeParse` + fallback
 *     `'system'` (default da coluna `user_prefs.theme`). 401 se sem auth.
 *
 * PATCH:
 *   - Body: `PreferencesPatchSchema` (`always_preview?`, `theme?`,
 *     `widgets_enabled?`, todos opcionais, `.strict()`). 400 se body vazio.
 *   - **UPSERT parcial de 1 statement** — só os campos presentes entram no
 *     INSERT e no `DO UPDATE SET ... = excluded.*` (não sobrescreve os ausentes;
 *     ex.: PATCH de `widgets_enabled` não zera `always_preview`). Os nomes de
 *     coluna vêm de uma whitelist do código (não do body) — seguro de injection.
 *   - Retorna os campos enviados (do body) + `updated_at = now()`.
 *   - Audit log entry (NFR16) — action `user_prefs.updated`.
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT) — NUNCA `getServiceDb()`.
 * Trace: Story 2.7 AC4+AC5+D32; Story 5.7 AC1; NFR5/NFR13/NFR16.
 */
import { sql, type SQL } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb } from '@/lib/agent/db-shim';
import {
  PreferencesPatchSchema,
  ThemeSchema,
  WidgetsEnabledSchema,
} from '@/lib/api-schemas/preferences';
// `DEFAULT_WIDGETS_ENABLED` é o espelho local apps/web (Story 5.6 PO-FIX-2 —
// importar o valor de `@meu-jarvis/db` quebraria a resolução `@/schema`,
// REQ-INLINE-1). Fonte canónica apps/web-side dos defaults de widgets.
import { DEFAULT_WIDGETS_ENABLED } from '@/app/(app)/visao/_lib/widgets';

const ROUTE = '/api/conta/preferencias';

/**
 * Resolve `household_id` activo do user (primeiro household do membership).
 * Mesma lógica do `/api/agent/prompt/route.ts` para consistência.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ household_id: string }>();

  if (error || !data) {
    return null;
  }
  return data.household_id;
}

/**
 * GET /api/conta/preferencias
 *
 * Lazy-init UPSERT (D32). Devolve `{ always_preview, widgets_enabled, theme }`
 * do user actual.
 *
 * Responses:
 *   - 200 `{ always_preview: boolean, widgets_enabled: WidgetsEnabled, theme: Theme }`
 *   - 401 AUTH_REQUIRED
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/preferencias',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      annotateSpan(span, { userId: user.id });

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateSpan(span, { statusCode: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      annotateSpan(span, { householdId });

      try {
        const db = getDb();

        // Lazy-init UPSERT — idempotente (D32).
        await db.execute(sql`
          insert into public.user_prefs (user_id, household_id, always_preview)
          values (${user.id}::uuid, ${householdId}::uuid, false)
          on conflict (user_id) do nothing
        `);

        const rows = await db.execute<{
          always_preview: boolean;
          widgets_enabled: unknown;
          theme: unknown;
        }>(sql`
          select always_preview, widgets_enabled, theme from public.user_prefs
          where user_id = ${user.id}::uuid
          limit 1
        `);

        const alwaysPreview = rows[0]?.always_preview ?? false;
        // Valida o JSONB lido — tolera shape drift / row recém-criada;
        // fallback ao default (Story 5.7 AC1.b; precedente `visao/page.tsx`).
        const widgetsParsed = WidgetsEnabledSchema.safeParse(rows[0]?.widgets_enabled);
        const widgetsEnabled = widgetsParsed.success
          ? widgetsParsed.data
          : DEFAULT_WIDGETS_ENABLED;
        // Story 5.8 AC4 — valida `theme` lido; fallback `'system'` (default da
        // coluna `user_prefs.theme`, migration 0016). Análogo ao padrão 5.7.
        const themeParsed = ThemeSchema.safeParse(rows[0]?.theme);
        const theme = themeParsed.success ? themeParsed.data : 'system';

        annotateSpan(span, { statusCode: 200 });
        log.info(
          { user_hash: hashForCorrelation(user.id), always_preview: alwaysPreview },
          'GET /api/conta/preferencias OK',
        );

        return NextResponse.json({
          always_preview: alwaysPreview,
          widgets_enabled: widgetsEnabled,
          theme,
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/preferencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao obter preferências. Tenta novamente.',
          500,
        );
      }
    },
  );
}

/**
 * PATCH /api/conta/preferencias
 *
 * Body: `{ always_preview: boolean }`. UPSERT idempotente.
 *
 * Responses:
 *   - 200 `{ always_preview: boolean }` actualizado
 *   - 400 VALIDATION_ERROR (Zod)
 *   - 401 AUTH_REQUIRED
 *   - 404 HOUSEHOLD_NOT_FOUND
 *   - 500 INTERNAL_ERROR
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/conta/preferencias',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateSpan(span, { statusCode: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      annotateSpan(span, { userId: user.id });

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateSpan(span, { statusCode: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      annotateSpan(span, { householdId });

      let body: { always_preview?: boolean; theme?: 'light' | 'dark' | 'system'; widgets_enabled?: Record<string, boolean> };
      try {
        const raw = await req.json();
        body = PreferencesPatchSchema.parse(raw);
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError(
            'VALIDATION_ERROR',
            'Body inválido — campos permitidos: `always_preview` (boolean), `theme` (light|dark|system), `widgets_enabled` (7 widgets boolean).',
            400,
            { issues: err.issues.map((i: z.ZodIssue) => ({ path: i.path, message: i.message })) },
          );
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      // Pelo menos um campo tem de estar presente (Story 5.7 AC1).
      const hasAlwaysPreview = body.always_preview !== undefined;
      const hasTheme = body.theme !== undefined;
      const hasWidgets = body.widgets_enabled !== undefined;
      if (!hasAlwaysPreview && !hasTheme && !hasWidgets) {
        annotateSpan(span, { statusCode: 400 });
        return apiError(
          'VALIDATION_ERROR',
          'Body inválido — pelo menos um campo (`always_preview`, `theme` ou `widgets_enabled`) é obrigatório.',
          400,
        );
      }

      try {
        const db = getDb();

        // UPSERT parcial de 1 statement — só os campos presentes entram no
        // INSERT e no DO UPDATE SET = excluded.* (os ausentes mantêm o valor
        // actual / default da coluna). Nomes de coluna vêm de whitelist do
        // código (não do body) → seguro de SQL injection.
        const insertCols: string[] = ['user_id', 'household_id'];
        const insertVals: SQL[] = [sql`${user.id}::uuid`, sql`${householdId}::uuid`];
        const updateSets: SQL[] = [];
        if (hasAlwaysPreview) {
          insertCols.push('always_preview');
          insertVals.push(sql`${body.always_preview}`);
          updateSets.push(sql`always_preview = excluded.always_preview`);
        }
        if (hasTheme) {
          insertCols.push('theme');
          insertVals.push(sql`${body.theme}`);
          updateSets.push(sql`theme = excluded.theme`);
        }
        if (hasWidgets) {
          insertCols.push('widgets_enabled');
          insertVals.push(sql`${JSON.stringify(body.widgets_enabled)}::jsonb`);
          updateSets.push(sql`widgets_enabled = excluded.widgets_enabled`);
        }
        updateSets.push(sql`updated_at = now()`);

        await db.execute(sql`
          insert into public.user_prefs (${sql.raw(insertCols.join(', '))})
          values (${sql.join(insertVals, sql`, `)})
          on conflict (user_id) do update
            set ${sql.join(updateSets, sql`, `)}
        `);

        // Audit log: [DEV-FIX-INLINE D36] enum `audit_action` actual não tem
        // `user_prefs.updated`. Adicionar enum value requer migration nova
        // (fora do scope desta story). NFR16 satisfeito via Pino structured
        // logger abaixo (action="user_prefs.updated" + campos tocados).
        // Story 2.8 ou follow-up adicionará `user_prefs_updated` ao enum.

        // Retorna apenas os campos enviados (Story 5.7 AC1.a) — sem SELECT extra
        // (mantém 1 call DB, retrocompat com testes Story 2.7). O `prefs-toggle`
        // legacy não lê a resposta success, mas mantemos `always_preview` quando
        // tocado para compatibilidade.
        const updated: {
          always_preview?: boolean;
          theme?: 'light' | 'dark' | 'system';
          widgets_enabled?: Record<string, boolean>;
        } = {};
        if (hasAlwaysPreview) updated.always_preview = body.always_preview;
        if (hasTheme) updated.theme = body.theme;
        if (hasWidgets) updated.widgets_enabled = body.widgets_enabled;

        annotateSpan(span, { statusCode: 200 });
        log.info(
          {
            user_hash: hashForCorrelation(user.id),
            action: 'user_prefs.updated',
            fields: Object.keys(updated),
          },
          'PATCH /api/conta/preferencias OK',
        );

        return NextResponse.json(updated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/conta/preferencias falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: user.id,
          route: ROUTE,
        });
        return apiError(
          'INTERNAL_ERROR',
          'Erro ao actualizar preferências. Tenta novamente.',
          500,
        );
      }
    },
  );
}
