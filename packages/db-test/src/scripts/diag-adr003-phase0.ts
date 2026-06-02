#!/usr/bin/env tsx
/**
 * Diagnóstico EMPÍRICO — ADR-003 Fase 0 (RLS enforced em runtime).
 *
 * Prova (ou refuta) a premissa central do ADR-003 (Opção A) ANTES de qualquer
 * código de produção. NÃO implementa o wrapper `withHousehold` — só mede.
 *
 * Premissa a provar:
 *   As 104 policies usam is_household_member(household_id) → auth.uid() →
 *   request.jwt.claims->>'sub'. A Opção A propõe ligar como role `authenticated`
 *   (sem rolbypassrls) e, dentro de uma transação, fazer
 *   `SET LOCAL request.jwt.claims = '{"sub":"<uid>", ...}'` (parametrizado) →
 *   então auth.uid() resolve o sub e as policies isolam.
 *
 * Ambiente: Postgres 16 efémero via Testcontainers (mesma imagem/bootstrap que a
 * suite RLS 166/166). Auto-contido — sobe o seu próprio container. NÃO toca em
 * dados reais. Opcionalmente faz leituras READ-ONLY de metadados contra a prod
 * (DIRECT_URL) para confirmar roles/funções no Supabase real, se a env existir.
 *
 * Responde, com output empírico, a 6 perguntas:
 *   1. Problema actual: o role da connection runtime tem rolbypassrls? RLS inerte hoje?
 *   2. Fonte da verdade: o que current_household_id()/is_household_member()/auth.uid() leem?
 *   3. Viabilidade Opção A: connection string com role authenticated (3a) OU
 *      SET LOCAL ROLE authenticated a partir do role actual (3b)? Qual funciona?
 *   4. Prova de isolamento: claims do user A → vê só A, 0 rows de B, auth.uid()=sub.
 *   5. pgbouncer safety: SET LOCAL reverte no commit (não vaza entre transações).
 *   6. getServiceDb() intacto: caminho service_role continua a bypassar RLS.
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db-test exec tsx src/scripts/diag-adr003-phase0.ts
 *
 * Requisitos: Docker em execução. Sem Docker, o script aborta com instrução clara
 * (e tenta na mesma a parte de metadados contra DIRECT_URL, se definido).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

import { applyBootstrap } from '@/harness/bootstrap';
import { applyMigrations } from '@/harness/migrations';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Carrega DIRECT_URL de packages/db/.env.local sem depender do pacote dotenv
 * (que não está nas deps do db-test). Parse mínimo: KEY=VALUE, ignora comentários.
 */
function loadDirectUrlFromEnvFile(): string | undefined {
  if (process.env.DIRECT_URL || process.env.DATABASE_URL_DIRECT) {
    return process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;
  }
  const envPath = resolve(__dirname, '..', '..', '..', 'db', '.env.local');
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, 'utf8');
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== 'DIRECT_URL' && key !== 'DATABASE_URL_DIRECT') continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitários de output
// ─────────────────────────────────────────────────────────────────────────────

const log = (...args: unknown[]): void => console.log(...args);
const section = (title: string): void => {
  log('\n' + '='.repeat(74));
  log(' ' + title);
  log('='.repeat(74));
};
const ok = (m: string): void => log('  [OK]   ' + m);
const fail = (m: string): void => log('  [FAIL] ' + m);
const info = (m: string): void => log('  [info] ' + m);

interface Findings {
  q1RuntimeBypass: boolean | null; // role runtime tem rolbypassrls?
  q1RlsInert: boolean | null; // RLS inerte hoje (vê linhas cross-household)?
  q3a: boolean | null; // connection string role=authenticated funciona?
  q3b: boolean | null; // SET LOCAL ROLE authenticated funciona?
  q4Isolation: boolean | null; // isolamento prova-se?
  q4AuthUid: boolean | null; // auth.uid() devolve o sub injectado?
  q5NoLeak: boolean | null; // SET LOCAL não vaza entre transações?
  q6ServiceBypass: boolean | null; // service_role bypassa RLS?
}

const findings: Findings = {
  q1RuntimeBypass: null,
  q1RlsInert: null,
  q3a: null,
  q3b: null,
  q4Isolation: null,
  q4AuthUid: null,
  q5NoLeak: null,
  q6ServiceBypass: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed: 2 households com dados de domínio (transactions + tasks) em cada
// ─────────────────────────────────────────────────────────────────────────────

interface Seed {
  householdA: string;
  householdB: string;
  userA: string;
  userB: string;
}

async function seedTwoHouseholds(adminSql: Sql): Promise<Seed> {
  const userA = randomUUID();
  const userB = randomUUID();
  const householdA = randomUUID();
  const householdB = randomUUID();

  // Desactivar triggers de onboarding que criariam households/colunas extra
  // (mesmo padrão que rls-harness.seedTwoHouseholds).
  await adminSql.unsafe(`alter table auth.users disable trigger on_auth_user_created`);
  await adminSql.unsafe(
    `alter table public.households disable trigger trigger_seed_kanban_after_household_insert`,
  );

  try {
    await adminSql`
      insert into auth.users (id, email) values
        (${userA}, ${'a-' + Date.now() + '@diag.test'}),
        (${userB}, ${'b-' + Date.now() + '@diag.test'})
    `;
    await adminSql`
      insert into public.households (id, name, owner_user_id, plan) values
        (${householdA}, 'Casa A', ${userA}, 'familia'),
        (${householdB}, 'Casa B', ${userB}, 'familia')
    `;
    await adminSql`
      insert into public.household_members (household_id, user_id, role) values
        (${householdA}, ${userA}, 'owner'),
        (${householdB}, ${userB}, 'owner')
    `;
    // Dados de domínio: 1 task + 1 transaction (precisa de conta) por household.
    await adminSql`
      insert into public.tasks (household_id, created_by_user_id, title) values
        (${householdA}, ${userA}, 'Tarefa privada A'),
        (${householdB}, ${userB}, 'Tarefa privada B')
    `;
    const accA = randomUUID();
    const accB = randomUUID();
    await adminSql`
      insert into public.accounts (id, household_id, name, account_type) values
        (${accA}, ${householdA}, 'Conta A', 'dinheiro'),
        (${accB}, ${householdB}, 'Conta B', 'dinheiro')
    `;
    await adminSql`
      insert into public.transactions
        (household_id, created_by_user_id, account_id, kind, amount_cents, description, transaction_date)
      values
        (${householdA}, ${userA}, ${accA}, 'expense', 1000, 'Despesa privada A', current_date),
        (${householdB}, ${userB}, ${accB}, 'expense', 2000, 'Despesa privada B', current_date)
    `;
  } finally {
    await adminSql.unsafe(
      `alter table public.households enable trigger trigger_seed_kanban_after_household_insert`,
    );
    await adminSql.unsafe(`alter table auth.users enable trigger on_auth_user_created`);
  }

  return { householdA, householdB, userA, userB };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q2 — Fonte da verdade: corpo das funções RLS
// ─────────────────────────────────────────────────────────────────────────────

async function q2_sourceOfTruth(sql: Sql): Promise<void> {
  section('Q2 — FONTE DA VERDADE das policies (corpo real das funções)');
  const fns = await sql<{ name: string; def: string }[]>`
    select p.proname as name, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('current_household_id', 'is_household_member'))
       or (n.nspname = 'auth' and p.proname = 'uid')
    order by p.proname
  `;
  for (const f of fns) {
    log(`\n  -- ${f.name} --`);
    log(
      f.def
        .split('\n')
        .map((l) => '    ' + l)
        .join('\n'),
    );
  }
  const authUid = fns.find((f) => f.name === 'uid');
  const isMember = fns.find((f) => f.name === 'is_household_member');
  if (authUid && /request\.jwt\.claims/.test(authUid.def) && /'sub'/.test(authUid.def)) {
    ok("auth.uid() lê request.jwt.claims ->> 'sub' (confirmado no corpo).");
  } else {
    fail('auth.uid() NÃO lê request.jwt.claims->>sub como esperado.');
  }
  if (isMember && /auth\.uid\(\)/.test(isMember.def) && /household_members/.test(isMember.def)) {
    ok('is_household_member() faz join a household_members por auth.uid() (D1/D2 confirmado).');
  } else {
    fail('is_household_member() não corresponde ao esperado.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 — Problema actual: role da connection + RLS inerte com bypassrls
// ─────────────────────────────────────────────────────────────────────────────

async function q1_currentProblem(adminSql: Sql, seed: Seed): Promise<void> {
  section('Q1 — PROBLEMA ACTUAL (role com rolbypassrls → RLS inerte)');

  // Identidade do role da connection admin (= análogo ao `postgres` do runtime,
  // que tem rolbypassrls=TRUE em produção Supabase). Aqui o superuser do container
  // tem rolsuper=TRUE → bypassa RLS na mesma. Provamos o efeito (RLS inerte).
  const who = await adminSql<
    { current_user: string; is_superuser: string; rolbypassrls: boolean | null }[]
  >`
    select current_user,
           current_setting('is_superuser') as is_superuser,
           (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls
  `;
  log('  Identidade da connection (análoga ao runtime getDb):');
  log('   ', who[0]);
  const bypass = who[0]?.is_superuser === 'on' || who[0]?.rolbypassrls === true;
  findings.q1RuntimeBypass = bypass;
  if (bypass) {
    ok('Role bypassa RLS (superuser/rolbypassrls). Em prod o runtime liga como `postgres` → idem.');
  } else {
    info('Role NÃO bypassa RLS neste ambiente — atenção à interpretação.');
  }

  // Prova empírica: sem claims, este role vê linhas de AMBOS os households?
  const rows = await adminSql<{ household_id: string; title: string }[]>`
    select household_id::text, title from public.tasks order by title
  `;
  const seesBoth =
    rows.some((r) => r.household_id === seed.householdA) &&
    rows.some((r) => r.household_id === seed.householdB);
  findings.q1RlsInert = seesBoth;
  log(`  SELECT * FROM tasks (sem claims) → ${rows.length} linhas visíveis:`);
  for (const r of rows) log(`     household=${r.household_id.slice(0, 8)}… "${r.title}"`);
  if (seesBoth) {
    fail('RLS INERTE: a connection vê tasks de A E de B sem qualquer filtro. Vazamento cross-tenant.');
  } else {
    ok('A connection não vê ambos os households (RLS aplicada neste role).');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q3 — Viabilidade Opção A: 3a (connection role=authenticated) vs 3b (SET LOCAL ROLE)
// ─────────────────────────────────────────────────────────────────────────────

async function q3_viability(containerUrl: string, adminSql: Sql): Promise<void> {
  section('Q3 — VIABILIDADE Opção A (3a connection dedicada vs 3b SET LOCAL ROLE)');

  // 3a — connection string com role=authenticated.
  // No Supabase, `authenticated` é NOLOGIN (não tem password próprio) → uma
  // connection string directa com user=authenticated FALHA. Provamos isto.
  info('3a — tentar ligar directamente com user=authenticated (esperado: falha, NOLOGIN)…');
  const u = new URL(containerUrl);
  u.username = 'authenticated';
  u.password = 'authenticated';
  const authConn = postgres(u.toString(), { max: 1, prepare: false, connect_timeout: 5 });
  try {
    await authConn`select 1`;
    findings.q3a = true;
    info('3a — connection directa como authenticated FUNCIONOU (ambiente permite login a este role).');
  } catch (err) {
    findings.q3a = false;
    ok(
      '3a — connection directa como authenticated FALHA (role NOLOGIN, como no Supabase). ' +
        'Mensagem: ' +
        (err instanceof Error ? err.message.split('\n')[0] : String(err)),
    );
  } finally {
    await authConn.end({ timeout: 2 }).catch(() => undefined);
  }

  // 3b — a partir do role actual, SET LOCAL ROLE authenticated dentro de uma tx.
  // Confirma que o role actual TEM privilégio de SET ROLE para authenticated.
  info('3b — SET LOCAL ROLE authenticated a partir do role actual (dentro de tx)…');
  try {
    await adminSql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      const r = await tx<{ current_user: string; rolbypassrls: boolean | null }[]>`
        select current_user,
               (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls
      `;
      log('    Dentro da tx após SET LOCAL ROLE:', r[0]);
      if (r[0]?.current_user === 'authenticated' && r[0]?.rolbypassrls === false) {
        findings.q3b = true;
        ok('3b — SET LOCAL ROLE authenticated FUNCIONA; role activo = authenticated, sem bypassrls.');
      } else {
        findings.q3b = false;
        fail('3b — SET LOCAL ROLE não produziu o role authenticated esperado.');
      }
    });
  } catch (err) {
    findings.q3b = false;
    fail('3b — SET LOCAL ROLE authenticated FALHOU: ' + (err instanceof Error ? err.message : err));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q4 — Prova de isolamento (claims de A → vê só A; 0 rows de B; auth.uid()=sub)
// ─────────────────────────────────────────────────────────────────────────────

async function q4_isolationProof(adminSql: Sql, seed: Seed): Promise<void> {
  section('Q4 — PROVA DE ISOLAMENTO (Opção A: SET LOCAL ROLE + SET LOCAL claims)');

  const result = await adminSql.begin(async (tx) => {
    await tx.unsafe('set local role authenticated');
    const claims = JSON.stringify({
      sub: seed.userA,
      household_id: seed.householdA,
      role: 'authenticated',
    });
    // Parametrizado (anti-injection) — set_config 3º arg true = local à tx.
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;

    const uid = await tx<{ auth_uid: string | null }[]>`select auth.uid()::text as auth_uid`;
    const tasks = await tx<{ household_id: string; title: string }[]>`
      select household_id::text, title from public.tasks
    `;
    const tx2 = await tx<{ household_id: string; description: string }[]>`
      select household_id::text, description from public.transactions
    `;
    const bRowsViaFilter = await tx<{ n: number }[]>`
      select count(*)::int as n from public.transactions where household_id = ${seed.householdB}
    `;
    return {
      authUid: uid[0]?.auth_uid ?? null,
      tasks,
      transactions: tx2,
      bVisible: bRowsViaFilter[0]?.n ?? -1,
    };
  });

  log(`  auth.uid() dentro da tx = ${result.authUid}`);
  log(`  (esperado = userA = ${seed.userA})`);
  findings.q4AuthUid = result.authUid === seed.userA;
  if (findings.q4AuthUid) ok('auth.uid() resolve o sub injectado nos claims.');
  else fail('auth.uid() NÃO corresponde ao sub injectado.');

  log(`\n  SELECT tasks como userA → ${result.tasks.length} linha(s):`);
  for (const t of result.tasks) log(`     household=${t.household_id.slice(0, 8)}… "${t.title}"`);
  log(`  SELECT transactions como userA → ${result.transactions.length} linha(s):`);
  for (const t of result.transactions)
    log(`     household=${t.household_id.slice(0, 8)}… "${t.description}"`);
  log(`  SELECT transactions WHERE household_id = B → ${result.bVisible} linha(s) (esperado 0)`);

  const onlyA =
    result.tasks.every((t) => t.household_id === seed.householdA) &&
    result.transactions.every((t) => t.household_id === seed.householdA) &&
    result.tasks.length === 1 &&
    result.transactions.length === 1 &&
    result.bVisible === 0;
  findings.q4Isolation = onlyA;
  if (onlyA) {
    ok('ISOLAMENTO PROVADO: userA vê apenas dados de A; dados de B = 0 rows (RLS aplicada).');
  } else {
    fail('Isolamento NÃO provado — userA viu dados fora de A.');
  }

  // INSERT cross-household deve ser rejeitado (WITH CHECK).
  info('INSERT cross-household (userA a tentar escrever em B) — esperado: rejeitado…');
  let insertBlocked = false;
  try {
    await adminSql.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      const claims = JSON.stringify({
        sub: seed.userA,
        household_id: seed.householdA,
        role: 'authenticated',
      });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx`
        insert into public.tasks (household_id, created_by_user_id, title)
        values (${seed.householdB}, ${seed.userA}, 'Hijack A→B')
      `;
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    insertBlocked = /row-level security|violates row-level|permission denied/i.test(msg);
  }
  if (insertBlocked) ok('INSERT cross-household bloqueado pelo WITH CHECK (defesa de escrita activa).');
  else fail('INSERT cross-household NÃO foi bloqueado.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Q5 — pgbouncer transaction-mode safety: SET LOCAL não vaza entre transações
// ─────────────────────────────────────────────────────────────────────────────

async function q5_noLeak(url: string, seed: Seed): Promise<void> {
  section('Q5 — SEGURANÇA pgbouncer (SET LOCAL reverte no commit, não vaza)');

  // Connection física dedicada (max:1) para garantir que as 2 transações
  // sequenciais reutilizam a MESMA connection física — exactamente o cenário
  // de risco do pooler transaction-mode.
  const phys = postgres(url, { max: 1, prepare: false });
  try {
    // Tx 1 — define claims do user A.
    const inTx1 = await phys.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      const claims = JSON.stringify({ sub: seed.userA, household_id: seed.householdA, role: 'authenticated' });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      const r = await tx<{ uid: string | null }[]>`select auth.uid()::text as uid`;
      return r[0]?.uid ?? null;
    });
    log(`  Tx1 (com SET LOCAL claims=userA): auth.uid() = ${inTx1}`);

    // Fora de qualquer transação, na MESMA connection física: o GUC dos claims
    // deve ter revertido para vazio/unset. Lemos o GUC cru (sem cast ::json)
    // para medir directamente a presença de fuga sem risco de erro de parse.
    const afterCommit = await phys<{ claims: string | null; cu: string }[]>`
      select nullif(current_setting('request.jwt.claims', true), '') as claims, current_user as cu
    `;
    const claimsAfter = afterCommit[0]?.claims ?? null;
    log(
      `  Após COMMIT, na mesma connection (fora de tx): request.jwt.claims = ${claimsAfter ?? 'NULL/vazio'}, current_user = ${afterCommit[0]?.cu}`,
    );

    // Tx 2 — SEM definir claims. Se SET LOCAL tivesse vazado, o GUC traria userA.
    const inTx2 = await phys.begin(async (tx) => {
      await tx.unsafe('set local role authenticated');
      const r = await tx<{ claims: string | null }[]>`
        select nullif(current_setting('request.jwt.claims', true), '') as claims
      `;
      return r[0]?.claims ?? null;
    });
    log(`  Tx2 (SEM definir claims): request.jwt.claims = ${inTx2 ?? 'NULL/vazio'} (esperado vazio — sem fuga)`);

    const noLeak = inTx1 === seed.userA && claimsAfter == null && inTx2 == null;
    findings.q5NoLeak = noLeak;
    if (noLeak) {
      ok('SET LOCAL confinado à transação: zero fuga de contexto entre requests na mesma connection.');
    } else {
      fail('Possível fuga de contexto entre transações — investigar antes de pooler 6543.');
    }
  } finally {
    await phys.end({ timeout: 3 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Q6 — getServiceDb() intacto: service_role bypassa RLS
// ─────────────────────────────────────────────────────────────────────────────

async function q6_serviceRoleBypass(adminSql: Sql, seed: Seed): Promise<void> {
  section('Q6 — getServiceDb() INTACTO (service_role continua a bypassar RLS)');

  // service_role foi criado com bypassrls no bootstrap. Simular o caminho service:
  // SET LOCAL ROLE service_role + SEM claims → deve ver AMBOS os households.
  const seesBoth = await adminSql.begin(async (tx) => {
    await tx.unsafe('set local role service_role');
    const rows = await tx<{ household_id: string }[]>`
      select household_id::text from public.tasks
    `;
    return (
      rows.some((r) => r.household_id === seed.householdA) &&
      rows.some((r) => r.household_id === seed.householdB)
    );
  });
  findings.q6ServiceBypass = seesBoth;
  if (seesBoth) {
    ok('service_role vê AMBOS os households (bypassa RLS) — jobs Inngest/migrations não são afectados.');
  } else {
    fail('service_role NÃO bypassou RLS — atenção, pode partir jobs.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadados de PRODUÇÃO (READ-ONLY) — confirma roles/funções no Supabase real
// ─────────────────────────────────────────────────────────────────────────────

async function prodMetadataReadOnly(): Promise<void> {
  const directUrl = loadDirectUrlFromEnvFile();
  section('PROD (READ-ONLY) — metadados de roles/funções no Supabase real');
  if (!directUrl) {
    info('DIRECT_URL não definido → secção saltada. (Esperado em CI/local sem .env.local.)');
    info('Limitação: a confirmação de roles em prod fica por fazer; o container reproduz o Supabase.');
    return;
  }
  const sql = postgres(directUrl, { max: 1, prepare: false, connect_timeout: 8 });
  try {
    const me = await sql<{ current_user: string; rolbypassrls: boolean | null }[]>`
      select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls
    `;
    log('  Role do runtime/DIRECT em prod:', me[0]);
    info(
      `Ponto 1 (prod): a connection liga como "${me[0]?.current_user}" com rolbypassrls=${me[0]?.rolbypassrls}.`,
    );

    const roles = await sql<{ rolname: string; rolcanlogin: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolcanlogin, rolbypassrls
      from pg_roles
      where rolname in ('postgres', 'authenticated', 'anon', 'service_role', 'supabase_auth_admin')
      order by rolname
    `;
    log('  Roles Supabase relevantes (prod):');
    console.table(roles);
    const authRole = roles.find((r) => r.rolname === 'authenticated');
    if (authRole) {
      info(
        `Ponto 3 (prod): role authenticated existe; rolcanlogin=${authRole.rolcanlogin} ` +
          `(NOLOGIN→caminho 3b SET LOCAL ROLE), rolbypassrls=${authRole.rolbypassrls} (esperado false).`,
      );
    }

    // Confirma que o role do runtime pode fazer SET ROLE authenticated em prod (sem escrever nada).
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        const r = await tx<{ cu: string }[]>`select current_user as cu`;
        info(`Ponto 3b (prod): SET LOCAL ROLE authenticated FUNCIONA (current_user=${r[0]?.cu}).`);
      });
    } catch (err) {
      info(
        'Ponto 3b (prod): SET LOCAL ROLE authenticated falhou — ' +
          (err instanceof Error ? err.message.split('\n')[0] : String(err)),
      );
    }
  } catch (err) {
    info('Erro a ligar a DIRECT_URL (prod): ' + (err instanceof Error ? err.message : String(err)));
    info('Secção de prod inconclusiva; o container Testcontainers fornece a evidência principal.');
  } finally {
    await sql.end({ timeout: 3 }).catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto
// ─────────────────────────────────────────────────────────────────────────────

function verdict(): number {
  section('VEREDICTO ADR-003 Fase 0');
  const checks: [string, boolean | null][] = [
    ['Q1 — RLS inerte hoje (problema confirmado)', findings.q1RlsInert],
    ['Q3b — SET LOCAL ROLE authenticated funciona', findings.q3b],
    ['Q4 — isolamento provado (só vê household próprio)', findings.q4Isolation],
    ['Q4 — auth.uid() resolve o sub injectado', findings.q4AuthUid],
    ['Q5 — SET LOCAL não vaza entre transações', findings.q5NoLeak],
    ['Q6 — service_role continua a bypassar RLS', findings.q6ServiceBypass],
  ];
  for (const [label, v] of checks) {
    log(`  ${v === true ? 'PASS' : v === false ? 'FAIL' : 'N/A '}  ${label}`);
  }
  const core = [
    findings.q3b,
    findings.q4Isolation,
    findings.q4AuthUid,
    findings.q5NoLeak,
    findings.q6ServiceBypass,
  ];
  const allCore = core.every((v) => v === true);
  log('');
  if (allCore && findings.q1RlsInert === true) {
    log('  VEREDICTO: GO — Opção A validada empiricamente (caminho 3b: SET LOCAL ROLE authenticated).');
    return 0;
  }
  if (allCore) {
    log('  VEREDICTO: GO-com-ressalvas — mecânica da Opção A valida; rever Q1 (problema actual).');
    return 0;
  }
  log('  VEREDICTO: NO-GO — pelo menos um critério core falhou. Ver detalhes acima.');
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log('############################################################################');
  log(' DIAGNÓSTICO ADR-003 Fase 0 — RLS enforced em runtime (premissa Opção A)');
  log(' Ambiente: Postgres 16 efémero (Testcontainers). NÃO toca em dados reais.');
  log('############################################################################');

  let container: StartedPostgreSqlContainer | null = null;
  let adminSql: Sql | null = null;
  let exitCode = 1;

  try {
    log('\n[setup] A iniciar Postgres 16 efémero (pgvector/pgvector:pg16)…');
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('adr003_diag')
      .withUsername('postgres')
      .withPassword('postgres')
      .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off'])
      .start();

    const url = container.getConnectionUri();
    log(`[setup] Postgres pronto em ${container.getHost()}:${container.getPort()}`);

    log('[setup] A aplicar bootstrap (role authenticated/service_role + auth.*)…');
    await applyBootstrap(url);
    log('[setup] A aplicar migrations de produção (0000…)…');
    await applyMigrations(url);

    adminSql = postgres(url, { max: 4, prepare: false, onnotice: () => undefined });

    log('[setup] A semear 2 households (A/B) com tasks + accounts + transactions…');
    const seed = await seedTwoHouseholds(adminSql);
    ok(`Seed pronto: householdA=${seed.householdA.slice(0, 8)}… householdB=${seed.householdB.slice(0, 8)}…`);

    await q2_sourceOfTruth(adminSql);
    await q1_currentProblem(adminSql, seed);
    await q3_viability(url, adminSql);
    await q4_isolationProof(adminSql, seed);
    await q5_noLeak(url, seed);
    await q6_serviceRoleBypass(adminSql, seed);

    exitCode = verdict();
  } catch (err) {
    fail('Erro fatal no diagnóstico: ' + (err instanceof Error ? err.stack ?? err.message : String(err)));
    info('Se o erro é de Docker, confirma que o Docker está em execução e tenta de novo.');
    exitCode = 1;
  } finally {
    if (adminSql) await adminSql.end({ timeout: 5 }).catch(() => undefined);
    if (container) {
      log('\n[teardown] A parar container efémero…');
      await container.stop().catch(() => undefined);
    }
  }

  // Metadados de prod (read-only) — corre mesmo que o container falhe, se DIRECT_URL existir.
  await prodMetadataReadOnly().catch((e) =>
    info('prodMetadata falhou: ' + (e instanceof Error ? e.message : String(e))),
  );

  return exitCode;
}

main().then((c) => process.exit(c));
