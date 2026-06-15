// @vitest-environment node
/**
 * Tests das páginas legais públicas `/privacidade` e `/termos` (prontidão
 * soft-launch / conformidade RGPD).
 *
 * Pattern: RSC env `node` — as páginas são Server Components estáticos e
 * síncronos (sem sessão, sem dados), pelo que basta invocá-las e serializar a
 * árvore React para asserções de presença de texto (mesmo `collectTree` da
 * `page.test.tsx`).
 *
 * Cobre as secções-chave que confirmam a estrutura RGPD/legal exigida.
 */
import { describe, expect, it } from 'vitest';

import PrivacidadePage from '@/app/privacidade/page';
import TermosPage from '@/app/termos/page';

/** Serializa a árvore React em string para asserções de presença de texto. */
function collectText(el: unknown): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map((c) => collectText(c)).join(' ');

  const node = el as { props?: Record<string, unknown> };
  return collectText(node.props?.children);
}

describe('Página /privacidade — Política de Privacidade (RGPD)', () => {
  const text = collectText(PrivacidadePage());

  it('renderiza o heading principal "Política de Privacidade"', () => {
    expect(text).toContain('Política de Privacidade');
  });

  it('inclui o aviso de RASCUNHO no topo', () => {
    expect(text).toContain('RASCUNHO');
  });

  it('menciona a CNPD (autoridade de controlo)', () => {
    expect(text).toContain('CNPD');
  });

  it('descreve os Direitos do titular dos dados', () => {
    expect(text).toContain('Direitos do titular');
    expect(text).toContain('portabilidade');
  });

  it('identifica os subcontratantes de IA e infraestrutura UE', () => {
    expect(text).toContain('Anthropic');
    expect(text).toContain('OpenAI');
    expect(text).toContain('Supabase');
    expect(text).toContain('Vercel');
  });
});

describe('Página /termos — Termos de Serviço', () => {
  const text = collectText(TermosPage());

  it('renderiza o heading principal "Termos de Serviço"', () => {
    expect(text).toContain('Termos de Serviço');
  });

  it('inclui o aviso de RASCUNHO no topo', () => {
    expect(text).toContain('RASCUNHO');
  });

  it('menciona o período experimental de 14 dias e a lei portuguesa', () => {
    expect(text).toContain('14 dias');
    expect(text).toContain('lei portuguesa');
  });

  it('refere a licença AGPL-3.0 do software', () => {
    expect(text).toContain('AGPL-3.0');
  });
});
