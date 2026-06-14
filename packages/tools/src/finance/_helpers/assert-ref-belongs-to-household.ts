/**
 * Helpers de hardening cross-tenant para referências EXPLÍCITAS de finanças
 * (`accountId` / `cardId` fornecidos pelo input da tool).
 *
 * Contexto / causa-raiz (handoff mj-handoff-smoke-pass-next-account-id-validation-20260614):
 *   A RLS de `transactions` (e irmãs) valida o `household_id` DA PRÓPRIA ROW
 *   (WITH CHECK = current_household_id()), mas NÃO valida que o `account_id` /
 *   `card_id` referenciado pertence ao MESMO household. O FK
 *   `transactions.account_id -> accounts.id` aceita qualquer conta existente,
 *   mesmo de outro agregado — foi a origem das 3 transacções cross-tenant que
 *   o B2 apagou (memória cross_tenant_legacy_transactions).
 *
 *   - Caminho SEGURO (default): quando o input NÃO traz conta nem cartão,
 *     `resolveDefaultAccount` faz SELECT RLS-scoped → a conta é garantidamente
 *     do household. Sem risco — NÃO passa por aqui.
 *   - Caminho VULNERÁVEL: quando o input TRAZ `accountId` (ou `cardId`)
 *     explícito, o valor entrava direto no INSERT sem verificação de pertença.
 *
 * Defesa em profundidade (DUAS redes):
 *   1.ª rede (app-enforced, SEC-1) — `assertAccountBelongsToHousehold` /
 *      `assertCardBelongsToHousehold`: PRÉ-CHECK preventivo. Antes do INSERT,
 *      um SELECT RLS-scoped (mesmo `ctx.db` authenticated que `resolveDefaultAccount`
 *      usa) confirma que a conta/cartão existe na vista RLS do household corrente.
 *      Se 0 rows (não existe OU pertence a outro household), lança
 *      `ToolExecutionError` PT-PT accionável ANTES de tocar na DB de escrita.
 *   2.ª rede (DB backstop, Fase 0 / migration 0023) — `mapFinanceFkGuardError`:
 *      se o trigger DB disparar (race condition, caller futuro que não passe
 *      pelo pré-check), o erro Postgres cru (SQLSTATE `23P51`) é convertido em
 *      `ToolExecutionError` PT-PT em vez de borbulhar como erro técnico.
 *
 * RLS (NFR5): o pré-check usa `ctx.db` (role `authenticated`, JWT-scoped).
 *   NUNCA `getServiceDb()` — isso ignoraria a RLS e mascararia o problema,
 *   "vendo" contas de outros households e deixando passar o INSERT vulnerável.
 *
 * Trace: handoff mj-handoff-smoke-pass-next-account-id-validation-20260614 (Fase A),
 *        migration 0023 (Fase 0 — contrato SQLSTATE 23P51), SEC-1 (1.ª rede
 *        app-enforced), `resolve-default-account.ts` (padrão de SELECT RLS-scoped).
 */
import { sql } from 'drizzle-orm';

import type { DrizzleDbClient } from '../../contracts';
import { ToolExecutionError } from '../../errors';

/**
 * SQLSTATE custom lançado pelos triggers da migration 0023 quando uma
 * referência de finanças aponta para outro household. postgres.js expõe o
 * código em `err.code`.
 */
export const FINANCE_FK_GUARD_SQLSTATE = '23P51';

interface ExistsRow {
  readonly id: string;
}

/**
 * Confirma que `accountId` existe na vista RLS do household corrente.
 *
 * Como o SELECT corre sob role `authenticated` (RLS activa), a query só "vê"
 * contas do próprio household. 0 rows ⇒ a conta não existe OU pertence a outro
 * agregado — ambos os casos são rejeitados com a mesma mensagem accionável
 * (não revelamos a existência de contas de outros households — defesa anti-IDOR).
 *
 * @throws {ToolExecutionError} quando a conta não pertence ao household corrente.
 */
export async function assertAccountBelongsToHousehold({
  db,
  accountId,
  toolName,
}: {
  readonly db: DrizzleDbClient;
  readonly accountId: string;
  readonly toolName: string;
}): Promise<void> {
  const rows = (await db.execute(sql`
    select id from accounts where id = ${accountId}::uuid limit 1
  `)) as ReadonlyArray<ExistsRow>;

  if (!rows[0]) {
    throw new ToolExecutionError(
      toolName,
      new Error(
        'A conta indicada não existe ou não pertence ao teu agregado familiar. Escolhe uma conta do agregado e tenta novamente.',
      ),
    );
  }
}

/**
 * Confirma que `cardId` existe na vista RLS do household corrente.
 *
 * Mesma garantia RLS que `assertAccountBelongsToHousehold`.
 *
 * @throws {ToolExecutionError} quando o cartão não pertence ao household corrente.
 */
export async function assertCardBelongsToHousehold({
  db,
  cardId,
  toolName,
}: {
  readonly db: DrizzleDbClient;
  readonly cardId: string;
  readonly toolName: string;
}): Promise<void> {
  const rows = (await db.execute(sql`
    select id from cards where id = ${cardId}::uuid limit 1
  `)) as ReadonlyArray<ExistsRow>;

  if (!rows[0]) {
    throw new ToolExecutionError(
      toolName,
      new Error(
        'O cartão indicado não existe ou não pertence ao teu agregado familiar. Escolhe um cartão do agregado e tenta novamente.',
      ),
    );
  }
}

/**
 * Type guard: lê de forma segura o `code` (SQLSTATE) de um erro `unknown`.
 *
 * O `err` apanhado num `catch` é `unknown` (sem `any` — NFR19/Constitution).
 * postgres.js anexa o SQLSTATE em `err.code`.
 */
function isPostgresErrorWithCode(err: unknown): err is { readonly code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}

/**
 * REDE FINAL (2.ª rede): mapeia o erro do trigger DB (SQLSTATE `23P51`,
 * migration 0023) para um `ToolExecutionError` PT-PT accionável.
 *
 * Cobre o caso em que o pré-check não apanhou a violação (race condition entre
 * o SELECT e o INSERT, ou um caller futuro que insira sem passar pelo pré-check).
 * Mantém as mensagens PT-PT definidas pela DB.
 *
 * Para qualquer outro erro, devolve-o intacto para o caller o re-lançar — NÃO
 * mascara erros não relacionados.
 *
 * @returns `ToolExecutionError` PT-PT se `err.code === '23P51'`; senão o `err`
 *   original (para o caller fazer `throw`).
 */
export function mapFinanceFkGuardError(toolName: string, err: unknown): unknown {
  if (!isPostgresErrorWithCode(err) || err.code !== FINANCE_FK_GUARD_SQLSTATE) {
    return err;
  }

  // A mensagem técnica do trigger distingue conta de cartão; escolhemos a
  // mensagem PT-PT accionável correspondente sem expor IDs ao utilizador.
  const technical = err instanceof Error ? err.message : '';
  const isCard = /cart[aã]o/i.test(technical);

  const userFacing = isCard
    ? 'O cartão indicado não pertence ao teu agregado familiar. Escolhe um cartão do agregado e tenta novamente.'
    : 'A conta indicada não pertence ao teu agregado familiar. Escolhe uma conta do agregado e tenta novamente.';

  return new ToolExecutionError(toolName, new Error(userFacing));
}
