/**
 * Testes para a hierarquia de erros do package tools.
 *
 * Trace: Story 2.3 AC8 + AC11 (cobertura ≥6 testes em errors.test.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  DuplicateToolError,
  redactToolInputForLog,
  ToolError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolPlanGateError,
  ToolTransactionError,
  ToolValidationError,
} from '@/errors';

describe('ToolError hierarchy', () => {
  it('todas as 6 subclasses herdam de ToolError + Error', () => {
    const errors: ToolError[] = [
      new ToolValidationError('criar_tarefa', 'titulo', 'string vazia'),
      new ToolExecutionError('criar_tarefa', new Error('boom')),
      new ToolTransactionError(new Error('deadlock')),
      new ToolNotFoundError('inexistente'),
      new DuplicateToolError('criar_tarefa', 'tasks'),
      new ToolPlanGateError('criar_parcelada', 'familia', 'pessoal'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(ToolError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.userMessage).toBe('string');
      expect(err.userMessage.length).toBeGreaterThan(0);
      expect(typeof err.retryable).toBe('boolean');
    }
  });

  it('apenas ToolTransactionError é retryable; resto é non-retryable', () => {
    expect(new ToolTransactionError(new Error()).retryable).toBe(true);

    expect(new ToolValidationError('x', 'y', 'z').retryable).toBe(false);
    expect(new ToolExecutionError('x', new Error()).retryable).toBe(false);
    expect(new ToolNotFoundError('x').retryable).toBe(false);
    expect(new DuplicateToolError('x', 'tasks').retryable).toBe(false);
    expect(new ToolPlanGateError('x', 'pro', 'free').retryable).toBe(false);
  });

  it('userMessage está em PT-PT em todas as 6 classes (vocabulário PT)', () => {
    expect(new ToolValidationError('x', 'y', 'z').userMessage).toMatch(
      /agente|formular|inválidos/,
    );
    expect(new ToolExecutionError('x', new Error()).userMessage).toMatch(
      /executar|operação|tenta/,
    );
    expect(new ToolTransactionError(new Error()).userMessage).toMatch(
      /tenta|temporário|operação/,
    );
    expect(new ToolNotFoundError('x').userMessage).toMatch(
      /agente|operação|suporte/,
    );
    expect(new DuplicateToolError('x', 'tasks').userMessage).toMatch(
      /configuração|suporte/,
    );
    expect(new ToolPlanGateError('x', 'pro', 'free').userMessage).toMatch(
      /plano|upgrade/,
    );
  });

  it('message técnico nunca contém input content (PII guard)', () => {
    // Simula um caller a passar input com PII no detail/cause.
    const piiTitulo = 'comprar leite no Pingo Doce — NIF 123456789';
    const validation = new ToolValidationError('criar_tarefa', 'titulo', 'string min 1');
    // O message inclui apenas toolName + field + regra técnica — nunca o valor.
    expect(validation.message).not.toContain(piiTitulo);
    expect(validation.message).not.toContain('123456789');

    // ToolExecutionError preserva cause mas o message só inclui o nome da
    // classe da excepção, não o seu message (que poderia ter PII).
    const causeWithPII = new Error(`failed for ${piiTitulo}`);
    const execErr = new ToolExecutionError('criar_tarefa', causeWithPII);
    expect(execErr.message).not.toContain(piiTitulo);
    expect(execErr.message).not.toContain('123456789');
  });

  it('preserva stack trace em V8 (debug)', () => {
    const err = new ToolValidationError('criar_tarefa', 'titulo', 'detalhe');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('ToolValidationError');
  });

  it('campos específicos das subclasses são acessíveis e tipados', () => {
    const validation = new ToolValidationError('t', 'campo_x', 'detalhe');
    expect(validation.field).toBe('campo_x');
    expect(validation.toolName).toBe('t');

    const exec = new ToolExecutionError('t', new TypeError('boom'));
    expect(exec.cause).toBeInstanceOf(TypeError);
    expect(exec.toolName).toBe('t');

    const tx = new ToolTransactionError(new Error('deadlock'));
    expect(tx.cause).toBeInstanceOf(Error);
    expect(tx.toolName).toBeUndefined();

    const dup = new DuplicateToolError('t', 'finance');
    expect(dup.domain).toBe('finance');
    expect(dup.toolName).toBe('t');

    const plan = new ToolPlanGateError('criar_parcelada', 'familia', 'pessoal');
    expect(plan.requiredPlan).toBe('familia');
    expect(plan.actualPlan).toBe('pessoal');
    expect(plan.toolName).toBe('criar_parcelada');
  });
});

describe('redactToolInputForLog', () => {
  it('retorna apenas { toolName, inputRedacted: true } — nunca o input', () => {
    const piiInput = { titulo: 'pagar IBAN PT50 1234 5678 9012 345', montanteCents: 12345 };
    const safe = redactToolInputForLog('criar_financa_variavel', piiInput);
    expect(safe).toEqual({ toolName: 'criar_financa_variavel', inputRedacted: true });
    // Garantia explícita: o objecto retornado é um novo objecto, não o input.
    expect(safe).not.toBe(piiInput);
    expect(JSON.stringify(safe)).not.toContain('PT50');
    expect(JSON.stringify(safe)).not.toContain('12345');
  });

  it('aceita input null/undefined sem expor', () => {
    expect(redactToolInputForLog('x', null)).toEqual({ toolName: 'x', inputRedacted: true });
    expect(redactToolInputForLog('x', undefined)).toEqual({ toolName: 'x', inputRedacted: true });
  });
});
