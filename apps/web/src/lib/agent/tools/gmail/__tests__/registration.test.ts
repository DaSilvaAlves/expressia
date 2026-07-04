// @vitest-environment node
/**
 * Teste anti-tree-shaking (Story J-6 Tarefa 7.4).
 *
 * Importar `run-agent.ts` (side-effect estático no topo deste ficheiro) deve
 * resultar na gmail tool registada no `toolRegistry` singleton — prova que o
 * side-effect import `import '@/lib/agent/tools/gmail/index';` dentro de
 * `run-agent.ts` NÃO foi eliminado pelo bundler e que a tool fica disponível
 * ANTES de qualquer invocação do Planner/Executor.
 *
 * Mocka as dependências pesadas de `run-agent.ts` (openai, upstash, db-shim,
 * auth) para o import não rebentar/pendurar — mas NÃO mocka `@meu-jarvis/tools`
 * (precisamos do toolRegistry real). Mesmo padrão que o `registration.test.ts`
 * das calendar tools (J-5).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser: vi.fn() }, from: vi.fn() })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: vi.fn() }),
  getServiceDb: () => ({ execute: vi.fn() }),
  withHousehold: <T,>(_auth: unknown, fn: (tx: { execute: () => Promise<unknown> }) => Promise<T>) =>
    fn({ execute: vi.fn() }),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

// Side-effect import ESTÁTICO — resolvido na fase de colecção (não em runtime do
// teste). Dispara o side-effect import da gmail tool dentro de run-agent.
import '@/lib/agent/run-agent';
import { toolRegistry } from '@meu-jarvis/tools';

describe('registo das gmail tools (anti tree-shaking)', () => {
  it('importar run-agent.ts regista consultar_emails', () => {
    expect(toolRegistry.has('consultar_emails')).toBe(true);

    // E o domínio está correcto.
    expect(toolRegistry.get('consultar_emails').domain).toBe('email');
  });

  it('importar run-agent.ts regista enviar_email (Story J-7)', () => {
    expect(toolRegistry.has('enviar_email')).toBe(true);
    expect(toolRegistry.get('enviar_email').domain).toBe('email');
  });

  it('importar run-agent.ts regista responder_email (Story J-8)', () => {
    expect(toolRegistry.has('responder_email')).toBe(true);
    expect(toolRegistry.get('responder_email').domain).toBe('email');
  });
});
