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

// ─────────────────────────────────────────────────────────────────────────────
// Story M-6 AC6 — formatMemories / isMemoryListOutput (listar_memorias)
// ─────────────────────────────────────────────────────────────────────────────

const MEM = (content: string, createdAt = '2026-07-07T09:00:00.000Z') => ({
  content,
  createdAt,
});

describe('renderReadToolResults — listar_memorias (Story M-6)', () => {
  it('0 memórias → mensagem PT-PT de lista vazia', () => {
    const text = renderReadToolResults([
      { toolName: 'listar_memorias', output: { memories: [], count: 0 } },
    ]);
    expect(text).toBe('Ainda não tenho nenhuma memória guardada sobre ti.');
  });

  it('1 memória → singular + conteúdo numerado', () => {
    const text = renderReadToolResults([
      {
        toolName: 'listar_memorias',
        output: { memories: [MEM('odeio reuniões antes das 10h')], count: 1 },
      },
    ]);
    expect(text).toBe('Tenho 1 memória guardada:\n1. odeio reuniões antes das 10h');
  });

  it('N memórias → plural + lista numerada com o conteúdo exacto', () => {
    const text = renderReadToolResults([
      {
        toolName: 'listar_memorias',
        output: {
          memories: [MEM('odeio reuniões antes das 10h'), MEM('prefiro café sem açúcar')],
          count: 2,
        },
      },
    ]);
    expect(text).toBe(
      'Tenho 2 memórias guardadas:\n1. odeio reuniões antes das 10h\n2. prefiro café sem açúcar',
    );
  });

  it('[PO-FIX-1] output embrulhado é desembrulhado (NÃO cai no fallback genérico)', () => {
    // Se `isMemoryListOutput` fizesse `Array.isArray(output)`, o objecto
    // `{ memories, count }` daria false → null → fallback "Executei N operações".
    // Este teste prova que o desembrulho de `output.memories` funciona.
    const text = renderReadToolResults([
      { toolName: 'listar_memorias', output: { memories: [MEM('X')], count: 1 } },
    ]);
    expect(text).not.toBeNull();
    expect(text).toContain('Tenho 1 memória guardada');
  });

  it('output com shape inesperado (sem memories) → null (defensivo)', () => {
    expect(
      renderReadToolResults([{ toolName: 'listar_memorias', output: { count: 3 } }]),
    ).toBeNull();
    // Array cru (forma de consultar_emails) NÃO é válido para listar_memorias.
    expect(
      renderReadToolResults([{ toolName: 'listar_memorias', output: [MEM('X')] }]),
    ).toBeNull();
  });

  it('não-interferência: consultar_emails continua a funcionar (sem regressão)', () => {
    const text = renderReadToolResults([
      { toolName: 'consultar_emails', output: [EMAIL()] },
      { toolName: 'listar_memorias', output: { memories: [MEM('X')], count: 1 } },
    ]);
    // O email aparece primeiro na ordem de procura — prova que os dois
    // formatadores coexistem sem colisão.
    expect(text).toBe('Tens 1 email:\n1. Pedro — Reunião amanhã');
  });
});
