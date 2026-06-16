// @vitest-environment node
/**
 * Testes unitários de `getServiceDb()` (SEC-10 AC4).
 *
 * Garantia de segurança: confirmam que o cliente `service_role` (que IGNORA RLS)
 * SÓ é construído a partir de uma das duas env vars dedicadas
 * (`DATABASE_URL_SERVICE_ROLE` com fallback `SUPABASE_DB_URL`) e NUNCA a partir
 * da `DATABASE_URL` de runtime normal — evita que a função seja acidentalmente
 * usada com a connection string do role `authenticated`. Sem nenhuma das duas
 * variáveis, a função lança em vez de degradar silenciosamente.
 *
 * Isolamento: `getServiceDb()` mantém um singleton interno `_serviceDb` no
 * módulo. Cada teste faz `vi.resetModules()` em `beforeEach` e importa o módulo
 * dinamicamente para obter uma instância fresca, sem depender da ordem de
 * inicialização do singleton. Env vars stubadas com `vi.stubEnv` +
 * `vi.unstubAllEnvs()` em `afterEach` (padrão SEC-9 PO-FIX-1).
 *
 * `postgres` e `drizzle-orm/postgres-js` são mockados — os testes não tocam numa
 * DB real (o caminho service_role real é exercitado em `@meu-jarvis/db-test`).
 *
 * Trace: SEC-10 AC4 / Tarefa 3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Captura a connection string passada ao driver `postgres()`. */
const captured = vi.hoisted(() => ({ urls: [] as string[] }));

/** Mock do driver `postgres`: regista o URL e devolve um stub. */
vi.mock('postgres', () => {
  const sqlFn = (url: string) => {
    captured.urls.push(url);
    return {};
  };
  return { default: sqlFn };
});

/** `drizzle()` devolve um objecto não-nulo qualquer (não tocamos na DB). */
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({ __isFakeDrizzle: true }),
}));

describe('getServiceDb (SEC-10 AC4)', () => {
  beforeEach(() => {
    captured.urls.length = 0;
    vi.resetModules();
    // Limpar quaisquer env vars relevantes herdadas do ambiente de execução.
    // `undefined` remove a var (em vez de a definir como string vazia): a
    // implementação usa `?? ` (coalescência nullish), portanto só `undefined`
    // activa o fallback — uma string vazia seria um valor de config inválido.
    vi.stubEnv('DATABASE_URL_SERVICE_ROLE', undefined);
    vi.stubEnv('SUPABASE_DB_URL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) com DATABASE_URL_SERVICE_ROLE definida → não lança e devolve objecto não-nulo', async () => {
    vi.stubEnv('DATABASE_URL_SERVICE_ROLE', 'postgres://service@host:5432/db');
    const { getServiceDb } = await import('@/client');

    const db = getServiceDb();
    expect(db).not.toBeNull();
    expect(db).toBeDefined();
    // Construído a partir da env var dedicada, nunca da DATABASE_URL de runtime.
    expect(captured.urls).toContain('postgres://service@host:5432/db');
  });

  it('(b) sem DATABASE_URL_SERVICE_ROLE mas com SUPABASE_DB_URL → usa o fallback', async () => {
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://fallback@host:5432/db');
    const { getServiceDb } = await import('@/client');

    const db = getServiceDb();
    expect(db).toBeDefined();
    expect(captured.urls).toContain('postgres://fallback@host:5432/db');
  });

  it('(c) sem nenhuma das duas variáveis → lança erro PT-PT explícito', async () => {
    const { getServiceDb } = await import('@/client');
    expect(() => getServiceDb()).toThrow(
      '[db/client] DATABASE_URL_SERVICE_ROLE não definido. Apenas para uso em servidor (Inngest, scripts).',
    );
  });

  it('NÃO usa a DATABASE_URL de runtime (role authenticated) como fonte', async () => {
    // Mesmo com a DATABASE_URL de runtime presente, sem as env vars de service
    // role a função tem de lançar — nunca cair na connection string normal.
    vi.stubEnv('DATABASE_URL', 'postgres://authenticated@host:6543/db');
    const { getServiceDb } = await import('@/client');
    expect(() => getServiceDb()).toThrow('DATABASE_URL_SERVICE_ROLE não definido');
    expect(captured.urls).not.toContain('postgres://authenticated@host:6543/db');
  });

  it('DATABASE_URL_SERVICE_ROLE tem precedência sobre SUPABASE_DB_URL', async () => {
    vi.stubEnv('DATABASE_URL_SERVICE_ROLE', 'postgres://primary@host:5432/db');
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://fallback@host:5432/db');
    const { getServiceDb } = await import('@/client');

    getServiceDb();
    expect(captured.urls).toContain('postgres://primary@host:5432/db');
    expect(captured.urls).not.toContain('postgres://fallback@host:5432/db');
  });
});
