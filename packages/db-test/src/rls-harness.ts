/**
 * RLS test harness — utilitários partilhados pelos testes de isolamento multi-tenant.
 *
 * Padrão de uso (ver exemplos em src/tests/*.rls.test.ts):
 *
 *   import { getRlsHarness, seedTwoHouseholds, asUser, resetData } from '@/rls-harness';
 *
 *   describe('RLS isolation: <tabela>', () => {
 *     beforeEach(async () => {
 *       await resetData();
 *     });
 *
 *     test('cross-household SELECT bloqueado', async () => {
 *       const { householdA, userA, householdB, userB } = await seedTwoHouseholds();
 *
 *       // 1. userA insere algo no householdA usando privilégios elevados (service-role).
 *       const adminClient = getRlsHarness().adminSql;
 *       await adminClient`insert into <tabela> (...)`;
 *
 *       // 2. userB (do householdB) tenta ver — deve ver 0 rows graças ao RLS.
 *       await asUser(userB.id, householdB.id, async (sql) => {
 *         const rows = await sql`select * from <tabela> where ...`;
 *         expect(rows).toHaveLength(0);
 *       });
 *     });
 *   });
 *
 * Notas técnicas:
 *   - O harness usa a env var RLS_TEST_DATABASE_URL injectada pelo globalSetup.
 *   - Há dois clientes: `adminSql` (sem RLS, para preparar dados) e
 *     `asUser()` (com RLS activo via `SET ROLE authenticated` + JWT claims).
 *   - `resetData()` truncate todas as tabelas em ordem topológica antes de cada teste,
 *     mantendo o schema intacto (mais rápido que dropar e recriar).
 *
 * Trace: Story 1.4 AC3, AC4, AC10. Architecture §3.2 (JWT claims), §10.2 (test pattern).
 */
import { randomUUID } from 'node:crypto';

import postgres, { type Sql, type TransactionSql } from 'postgres';

/**
 * Tipo de cliente que aceita queries — abrange tanto a connection-level (`Sql`)
 * como a transactional (`TransactionSql` recebida dentro de `begin()`).
 *
 * Usar este tipo nas helpers que precisam aceitar ambos os contextos
 * (admin singleton OU transação dentro de `asUser()`).
 */
export type QuerySql = Sql | TransactionSql;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface TestUser {
  /** UUID do utilizador (usado em JWT sub claim). */
  readonly id: string;
  readonly email: string;
}

export interface TestHousehold {
  /** UUID do household (usado em JWT household_id claim). */
  readonly id: string;
  readonly name: string;
}

export interface TwoHouseholdsSeed {
  readonly householdA: TestHousehold;
  readonly householdB: TestHousehold;
  readonly userA: TestUser;
  readonly userB: TestUser;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton de connections — criado lazy na primeira utilização
// ─────────────────────────────────────────────────────────────────────────────

interface RlsHarness {
  /**
   * Cliente postgres "admin" — corre como superuser do container, ignora RLS.
   * Usar apenas para preparar dados de teste (seed) e para `resetData()`.
   */
  readonly adminSql: Sql;
  /** Connection URL injectada pelo globalSetup. */
  readonly url: string;
}

let _harness: RlsHarness | null = null;

/**
 * Acessor singleton do harness. Lança se chamado antes do globalSetup correr.
 */
export function getRlsHarness(): RlsHarness {
  if (_harness) return _harness;

  const url = process.env.RLS_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      '[rls-harness] RLS_TEST_DATABASE_URL não definido. ' +
        'O globalSetup do Vitest deve ter falhado ou não correu.',
    );
  }

  const adminSql = postgres(url, {
    max: 4,
    prepare: false,
    onnotice: () => {
      // Suprimir NOTICEs (ex: "schema already exists").
    },
  });

  _harness = { adminSql, url };
  return _harness;
}

/**
 * Limpa explicitamente o singleton — usado em afterAll para libertar connections.
 * Vitest globalSetup teardown trata do container; aqui só fechamos pools.
 */
export async function closeRlsHarness(): Promise<void> {
  if (_harness) {
    await _harness.adminSql.end({ timeout: 5 });
    _harness = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resetData — limpa estado entre testes mantendo o schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tabelas truncadas em cada `resetData()`, em ordem topológica REVERSA
 * (dependências primeiro, agregados raiz por último).
 *
 * NOTA: usamos `TRUNCATE ... CASCADE RESTART IDENTITY` que é dramaticamente
 * mais rápido que DELETE row-by-row e respeita FKs.
 *
 * `auth.users` é truncada porque os utilizadores criados em testes anteriores
 * não devem persistir (cada teste seed cria os seus próprios).
 *
 * `categories` defaults com `household_id IS NULL` SOBREVIVEM porque foram
 * inseridos pela migration de produção (0002 não existe ainda mas no futuro
 * pode haver). Categorias de teste com household_id são apagadas pelo CASCADE
 * dos households.
 */
const TABLES_TO_TRUNCATE = [
  'task_tags',
  'task_recurrences',
  'tasks',
  'tags',
  'kanban_columns',
  'transactions',
  'installments',
  'recurrences',
  'cards',
  'accounts',
  'agent_reverse_ops',
  'intent_classifications',
  'agent_quotas',
  'agent_runs',
  'invoices',
  'payment_methods',
  'payment_events',
  'subscriptions',
  'audit_log',
  'data_export_jobs',
  'account_deletion_jobs',
  'feature_flags',
  'household_invites',
  'household_members',
  'households',
] as const;

/**
 * Trunca todas as tabelas de domínio + auth.users.
 *
 * Categorias são tratadas separadamente: as per-household são removidas pelo CASCADE
 * de `households`, mas as defaults (household_id IS NULL) ficam — isso é desejado
 * porque correspondem ao seed de produção.
 *
 * Em testes que precisem isolar também as defaults globais, fazer truncate manual:
 *   `await adminSql\`truncate table public.categories cascade\`` (apaga TUDO).
 */
export async function resetData(): Promise<void> {
  const { adminSql } = getRlsHarness();

  // Constrói a lista qualificada e usa CASCADE para honrar FKs entre tabelas truncadas.
  const tableList = TABLES_TO_TRUNCATE.map((t) => `public.${t}`).join(', ');

  await adminSql.unsafe(`truncate table ${tableList}, auth.users cascade`);

  // Apaga categorias custom (per-household) que tenham sobrevivido.
  // (Defaults `is_default = true and household_id is null` mantêm-se.)
  await adminSql.unsafe(
    `delete from public.categories where household_id is not null`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// seedTwoHouseholds — fixture standard para testes cross-household
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria dois households independentes, cada um com um utilizador membro.
 *
 * Cenário típico:
 *   - userA pertence a householdA (role: owner).
 *   - userB pertence a householdB (role: owner).
 *   - Ambos os users e households são criados via admin (sem RLS) para preparação rápida.
 *
 * Os testes depois usam `asUser(userA.id, householdA.id, ...)` para correr operações
 * como esse utilizador, com RLS activo, e verificar que o cross-household não funciona.
 */
export async function seedTwoHouseholds(): Promise<TwoHouseholdsSeed> {
  const { adminSql } = getRlsHarness();

  const userA: TestUser = {
    id: randomUUID(),
    email: `usera-${Date.now()}@meu-jarvis.test`,
  };
  const userB: TestUser = {
    id: randomUUID(),
    email: `userb-${Date.now()}@meu-jarvis.test`,
  };

  // Story 1.5 (migration 0003) introduziu trigger `on_auth_user_created` em
  // auth.users que cria automaticamente household + membership + subscription
  // + audit_log para cada novo utilizador. Os testes de RLS pré-existentes
  // assumem controlo total sobre quantos households/subscriptions existem,
  // logo desactivamos o trigger durante o seed e re-ligamos no fim.
  // Sem isto, cada `seedTwoHouseholds()` cria 4 households (2 manuais + 2 do
  // trigger) e quebra todas as asserções de toHaveLength(1).
  //
  // Story 3.1 (migration 0009) introduziu trigger
  // `trigger_seed_kanban_after_household_insert` em public.households que cria
  // automaticamente 3 kanban_columns default PT-PT (sort_order 0/1/2) por
  // cada household inserido. Os testes de RLS sobre `kanban_columns` assumem
  // tabela vazia após o seed — sem desactivar este trigger, cada
  // `seedTwoHouseholds()` injecta 6 kanban_columns extra (3 por household) e
  // quebra asserções como `toHaveLength(0)` em SELECT cross-household, ou
  // colide com unique constraint `kanban_columns_unique_order` quando o teste
  // tenta inserir manualmente uma coluna com `sortOrder = 0`.
  await adminSql.unsafe(`alter table auth.users disable trigger on_auth_user_created`);
  await adminSql.unsafe(
    `alter table public.households disable trigger trigger_seed_kanban_after_household_insert`,
  );

  try {
    // 1. Inserir users em auth.users (FKs do schema referenciam isto).
    await adminSql`
      insert into auth.users (id, email)
      values
        (${userA.id}, ${userA.email}),
        (${userB.id}, ${userB.email})
    `;

    // 2. Criar households com cada user como owner.
    const householdA: TestHousehold = {
      id: randomUUID(),
      name: 'Casa A',
    };
    const householdB: TestHousehold = {
      id: randomUUID(),
      name: 'Casa B',
    };

    await adminSql`
      insert into public.households (id, name, owner_user_id, plan)
      values
        (${householdA.id}, ${householdA.name}, ${userA.id}, 'familia'),
        (${householdB.id}, ${householdB.name}, ${userB.id}, 'familia')
    `;

    // 3. Membership: cada user é owner do seu household.
    await adminSql`
      insert into public.household_members (household_id, user_id, role)
      values
        (${householdA.id}, ${userA.id}, 'owner'),
        (${householdB.id}, ${userB.id}, 'owner')
    `;

    return { householdA, householdB, userA, userB };
  } finally {
    // Re-activar ambos os triggers — testes específicos
    // (handle-new-user.trigger.test.ts da Story 1.5 e
    // kanban_seed.trigger.test.ts da Story 3.1) dependem deles estarem ligados.
    // `try/finally` garante que mesmo um erro no seed não os deixa desligados
    // para os testes seguintes na mesma suite.
    await adminSql.unsafe(
      `alter table public.households enable trigger trigger_seed_kanban_after_household_insert`,
    );
    await adminSql.unsafe(`alter table auth.users enable trigger on_auth_user_created`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// asUser — corre código com RLS activo simulando um utilizador autenticado
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa `fn` com:
 *   - `SET LOCAL ROLE authenticated` (activa as RLS policies do schema)
 *   - `request.jwt.claims` definido como `{"sub": userId, "household_id": householdId}`
 *
 * Tudo dentro de uma única transação que faz commit no fim. Se `fn` lançar, é rollback.
 *
 * IMPORTANTE: o `sql` recebido por `fn` está bound à transação — usar APENAS dentro do
 * callback. Após o callback fechar, esse handle deixa de ser válido.
 *
 * @example
 *   await asUser(userA.id, householdA.id, async (sql) => {
 *     const tasks = await sql`select * from public.tasks`;
 *     expect(tasks).toHaveLength(2);
 *   });
 *
 * @example Forma de testar que uma operação rejeita por RLS:
 *   await asUser(userB.id, householdB.id, async (sql) => {
 *     await expect(
 *       sql`insert into public.tasks (household_id, ...) values (${householdA.id}, ...)`
 *     ).rejects.toThrow(/row-level security|new row violates/i);
 *   });
 */
export async function asUser<T>(
  userId: string,
  householdId: string,
  fn: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  const { adminSql } = getRlsHarness();

  // postgres.js sql.begin() corre o callback numa transação dedicada com a mesma pool.
  // Usamos parameterized binding para o JSON dos claims (evita injection via userId/householdId).
  const claims = JSON.stringify({ sub: userId, household_id: householdId, role: 'authenticated' });

  // O cast é necessário porque postgres.js declara `begin()` a devolver
  // `Promise<UnwrapPromiseArray<T>>` (transformação que afecta apenas se T for array de promessas).
  // Como o nosso T não é array de promessas, UnwrapPromiseArray<T> = T.
  return adminSql.begin(async (tx) => {
    // 1. Bater para o role authenticated (afecta apenas esta transação graças a SET LOCAL).
    await tx.unsafe('set local role authenticated');

    // 2. Definir os JWT claims via set_config('request.jwt.claims', ..., true).
    //    O 3º argumento true = is_local: limitado à transação. Igual ao Supabase Auth Hook.
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    return fn(tx);
  }) as Promise<T>;
}

/**
 * Variante de `asUser()` para casos em que se quer afirmar que uma operação INSERT
 * cross-household é REJEITADA pelo RLS.
 *
 * Aceita uma função `op(sql)` que executa o INSERT/UPDATE/DELETE problemático.
 * Devolve um `Promise` que resolve com `true` se a operação rejeitar (RLS bloqueou)
 * e com `false` se passou (não bloqueou — teste deve falhar).
 *
 * Útil para escrever asserções claras em testes:
 *   const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
 *     await sql\`insert into public.tasks (household_id, ...) values (${householdA.id}, ...)\`
 *   })
 *   expect(blocked).toBe(true)
 */
export async function expectRlsBlocks(
  userId: string,
  householdId: string,
  op: (sql: TransactionSql) => Promise<unknown>,
): Promise<boolean> {
  try {
    await asUser(userId, householdId, op);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Postgres devolve "new row violates row-level security policy" ou similar.
    return /row-level security|violates row-level|permission denied/i.test(message);
  }
}
