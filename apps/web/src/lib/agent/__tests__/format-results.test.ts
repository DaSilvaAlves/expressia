// @vitest-environment node
/**
 * Testes do renderizador de resultados de tools de leitura (Story J-6 AC15a).
 */
import { describe, expect, it } from 'vitest';

import { renderReadToolResults } from '@/lib/agent/format-results';

const EMAIL = (over: Partial<Record<string, string>> = {}) => ({
  id: over.id ?? 'm1',
  subject: over.subject ?? 'Reunião amanhã',
  from: over.from ?? 'Pedro <pedro@example.com>',
  receivedAt: over.receivedAt ?? 'Fri, 27 Jun 2026 10:30:00 +0000',
  snippet: over.snippet ?? 'Confirmas?',
});

describe('renderReadToolResults', () => {
  it('formata a lista de emails com assunto + nome do remetente', () => {
    const text = renderReadToolResults([
      {
        toolName: 'consultar_emails',
        output: [
          EMAIL(),
          EMAIL({ id: 'm2', subject: 'Extrato', from: '"Banco BPI" <no-reply@bpi.pt>' }),
        ],
      },
    ]);
    expect(text).toBe('Tens 2 emails:\n1. Pedro — Reunião amanhã\n2. Banco BPI — Extrato');
  });

  it('usa singular para 1 email', () => {
    const text = renderReadToolResults([{ toolName: 'consultar_emails', output: [EMAIL()] }]);
    expect(text).toBe('Tens 1 email:\n1. Pedro — Reunião amanhã');
  });

  it('lista vazia → mensagem PT-PT amigável', () => {
    const text = renderReadToolResults([{ toolName: 'consultar_emails', output: [] }]);
    expect(text).toBe('Não encontrei emails para mostrar.');
  });

  it('remetente sem nome de exibição usa o email', () => {
    const text = renderReadToolResults([
      { toolName: 'consultar_emails', output: [EMAIL({ from: 'pedro@example.com' })] },
    ]);
    expect(text).toContain('pedro@example.com — Reunião amanhã');
  });

  it('assunto vazio → "(sem assunto)"', () => {
    const text = renderReadToolResults([
      { toolName: 'consultar_emails', output: [EMAIL({ subject: '  ' })] },
    ]);
    expect(text).toContain('1. Pedro — (sem assunto)');
  });

  it('sem tool de leitura renderizável → null (mantém resumo genérico)', () => {
    expect(
      renderReadToolResults([{ toolName: 'criar_tarefa', output: { id: 't1' } }]),
    ).toBeNull();
    expect(renderReadToolResults([])).toBeNull();
  });

  it('output com shape inesperado → null (defensivo)', () => {
    expect(
      renderReadToolResults([{ toolName: 'consultar_emails', output: { not: 'an array' } }]),
    ).toBeNull();
  });
});
