// @vitest-environment node
/**
 * Teste anti-tree-shaking (Story J-5 Tarefa 7.6).
 *
 * Importar `run-agent.ts` (side-effect estático no topo deste ficheiro) deve
 * resultar nas calendar tools registadas no `toolRegistry` singleton — prova que
 * o side-effect import `import '@/lib/agent/tools/calendar/index';` dentro de
 * `run-agent.ts` NÃO foi eliminado pelo bundler e que as tools ficam disponíveis
 * ANTES de qualquer invocação do Planner/Executor.
 *
 * Mocka as dependências pesadas de `run-agent.ts` (openai, upstash, db-shim,
 * auth) para o import não rebentar/pendurar — mas NÃO mocka `@meu-jarvis/tools`
 * (precisamos do toolRegistry real) nem `@meu-jarvis/classifier`/
 * `@meu-jarvis/planner-executor` (importes reais, mas não invocados).
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
// teste). Dispara o side-effect import das calendar tools dentro de run-agent.
import '@/lib/agent/run-agent';
import { toolRegistry } from '@meu-jarvis/tools';

describe('registo das calendar tools (anti tree-shaking)', () => {
  it('importar run-agent.ts regista criar_evento_calendario e reagendar_evento_calendario', () => {
    expect(toolRegistry.has('criar_evento_calendario')).toBe(true);
    expect(toolRegistry.has('reagendar_evento_calendario')).toBe(true);

    // E o domínio está correcto.
    expect(toolRegistry.get('criar_evento_calendario').domain).toBe('calendar');
    expect(toolRegistry.get('reagendar_evento_calendario').domain).toBe('calendar');
  });
});
