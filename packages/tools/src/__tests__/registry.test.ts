/**
 * Testes para `ToolRegistry`.
 *
 * Trace: Story 2.3 AC3 + AC11 (≥8 testes em registry.test.ts).
 *
 * Endereça suggested improvement #3 do `@aiox-po` Pax (gate 2026-05-08):
 * teste explícito de idempotência por referência em `register()`.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import type { ToolDefinition } from '@/contracts';
import { DuplicateToolError, ToolNotFoundError } from '@/errors';
import { ToolRegistry } from '@/registry';

import { echoTool, failTool, slowTool } from '@/__fixtures__/mock-tools';

/**
 * Factory: cria uma tool minimal com nome dado, para testes que precisem de
 * controlar a referência (idempotência).
 */
function makeTool(name: string, domain: 'tasks' | 'finance' = 'tasks'): ToolDefinition<{ x: number }, { y: number }> {
  return {
    name,
    domain,
    description: `mock '${name}'`,
    inputSchema: z.object({ x: z.number() }),
    outputSchema: z.object({ y: z.number() }),
    preview: () => `preview ${name}`,
    execute: async (input) => ({ y: input.x * 2 }),
    reverse: async () => ({ kind: 'delete_row', table: 'mock', id: '11111111-1111-4111-8111-111111111111' }),
  };
}

describe('ToolRegistry — happy paths', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('register + get devolve a mesma tool', () => {
    const t = makeTool('criar_tarefa');
    registry.register(t);
    expect(registry.get('criar_tarefa')).toBe(t);
  });

  it('list devolve as tools registadas em ordem de inserção', () => {
    const t1 = makeTool('a');
    const t2 = makeTool('b');
    const t3 = makeTool('c');
    registry.register(t1);
    registry.register(t2);
    registry.register(t3);
    const list = registry.list();
    expect(list.length).toBe(3);
    expect(list[0]?.name).toBe('a');
    expect(list[1]?.name).toBe('b');
    expect(list[2]?.name).toBe('c');
  });

  it('getByDomain filtra correctamente por domínio', () => {
    const t1 = makeTool('criar_tarefa', 'tasks');
    const t2 = makeTool('atualizar_tarefa', 'tasks');
    const t3 = makeTool('criar_financa_variavel', 'finance');
    registry.register(t1);
    registry.register(t2);
    registry.register(t3);

    const tasks = registry.getByDomain('tasks');
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.name).sort()).toEqual(['atualizar_tarefa', 'criar_tarefa']);

    const finance = registry.getByDomain('finance');
    expect(finance.length).toBe(1);
    expect(finance[0]?.name).toBe('criar_financa_variavel');

    const query = registry.getByDomain('query');
    expect(query.length).toBe(0);
  });

  it('has() devolve true/false sem lançar', () => {
    const t = makeTool('x');
    registry.register(t);
    expect(registry.has('x')).toBe(true);
    expect(registry.has('inexistente')).toBe(false);
  });
});

describe('ToolRegistry — idempotência por referência (PO suggestion #3)', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('register(toolA) duas vezes com a MESMA referência é no-op (não lança)', () => {
    const t = makeTool('criar_tarefa');
    registry.register(t);
    expect(() => registry.register(t)).not.toThrow();
    expect(registry.list().length).toBe(1);
    expect(registry.get('criar_tarefa')).toBe(t);
  });

  it('register de DUAS instâncias diferentes com o mesmo `name` lança DuplicateToolError', () => {
    const t1 = makeTool('criar_tarefa');
    const t2 = makeTool('criar_tarefa'); // nova referência
    registry.register(t1);
    expect(() => registry.register(t2)).toThrow(DuplicateToolError);
    // O registry mantém a primeira tool registada.
    expect(registry.get('criar_tarefa')).toBe(t1);
  });
});

describe('ToolRegistry — erros', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('get() de tool não-registada lança ToolNotFoundError', () => {
    expect(() => registry.get('inexistente')).toThrow(ToolNotFoundError);
  });

  it('DuplicateToolError carrega name + domain', () => {
    const t1 = makeTool('finance_tool', 'finance');
    const t2 = makeTool('finance_tool', 'finance');
    registry.register(t1);
    let captured: unknown;
    try {
      registry.register(t2);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(DuplicateToolError);
    if (captured instanceof DuplicateToolError) {
      expect(captured.toolName).toBe('finance_tool');
      expect(captured.domain).toBe('finance');
    }
  });
});

describe('ToolRegistry — getAnthropicToolDefinitions', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('serializa input_schema via zod-to-json-schema (jsonSchema7)', () => {
    registry.register(echoTool);
    const defs = registry.getAnthropicToolDefinitions();
    expect(defs.length).toBe(1);
    const [def] = defs;
    expect(def?.name).toBe('echo_test');
    expect(def?.description).toBe('Mock tool — repete o input. Usado apenas em testes.');
    expect(def?.input_schema).toBeDefined();
    expect(typeof def?.input_schema).toBe('object');
    // JSON Schema 7 typical shape: tem properties.text e type === 'object'.
    const schema = def?.input_schema as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeDefined();
    expect(schema.properties?.['text']).toBeDefined();
  });

  it('vazio quando registry está vazio', () => {
    expect(registry.getAnthropicToolDefinitions()).toEqual([]);
  });

  it('preserva ordem de registo na conversão', () => {
    registry.register(echoTool);
    registry.register(failTool);
    registry.register(slowTool);
    const names = registry.getAnthropicToolDefinitions().map((d) => d.name);
    expect(names).toEqual(['echo_test', 'fail_test', 'slow_test']);
  });
});

describe('ToolRegistry — clear() (apenas testes)', () => {
  it('clear() esvazia o Map interno', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));
    expect(registry.list().length).toBe(2);

    registry.clear();
    expect(registry.list().length).toBe(0);
    expect(registry.has('a')).toBe(false);
    expect(() => registry.get('a')).toThrow(ToolNotFoundError);
  });
});
