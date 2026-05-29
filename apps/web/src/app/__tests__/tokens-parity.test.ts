// @vitest-environment node
/**
 * Teste de parity de tokens (Story 5.8 AC5.d / PO-FIX-1 / DP-5.8.C).
 *
 * Garante que `packages/ui/src/tokens.ts` (fonte canónica hex) e as CSS vars de
 * `apps/web/src/app/globals.css` estão em sincronia — sem drift (FUP-5.3.B).
 *
 * REGRA ANTI-INVENÇÃO (Article IV / PO-FIX-1): a parity NÃO exige simetria.
 *   - `colorsLight` = 19 tokens → cada um tem CSS var em `:root`.
 *   - `colorsDark`  = 16 tokens → cada um tem CSS var em `.dark`.
 *   - Os 3 `*Subtle` de status (`successSubtle`/`warningSubtle`/`dangerSubtle`)
 *     existem só em `:root` (modo claro). NÃO são inventados em `.dark`.
 *
 * Mapeamento de nome: camelCase do token → kebab-case da CSS var
 * (ex.: `bgCanvas` → `--bg-canvas`; `primarySubtle` → `--primary-subtle`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { tokens } from '@meu-jarvis/ui';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/web/src/app/__tests__ → apps/web/src/app/globals.css
const GLOBALS_CSS = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');

/** camelCase → kebab-case CSS var name (`bgCanvas` → `--bg-canvas`). */
function toCssVarName(token: string): string {
  return '--' + token.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Normaliza hex para comparação (lowercase, sem espaços). */
function normHex(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Extrai o valor literal de uma CSS var dentro de um bloco de seletor.
 * Procura `--nome: VALOR;` apenas dentro do `{ ... }` do seletor pedido.
 */
function readVarInSelector(
  css: string,
  selector: string,
  varName: string,
): string | null {
  // Captura o corpo do PRIMEIRO bloco do seletor (`:root { ... }` / `.dark { ... }`).
  const blockRegex = new RegExp(
    `${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\}`,
  );
  const block = blockRegex.exec(css);
  if (!block || !block[1]) return null;
  const varRegex = new RegExp(`${varName}\\s*:\\s*([^;]+);`);
  const m = varRegex.exec(block[1]);
  return m && m[1] ? m[1].trim() : null;
}

const DARK_OMITTED = new Set(['successSubtle', 'warningSubtle', 'dangerSubtle']);

describe('Parity de tokens — contagem (PO-FIX-1 / Article IV)', () => {
  it('colorsLight tem 19 tokens', () => {
    expect(Object.keys(tokens.colors.light)).toHaveLength(19);
  });

  it('colorsDark tem 16 tokens (3 *Subtle omissos — não inventados)', () => {
    expect(Object.keys(tokens.colors.dark)).toHaveLength(16);
    for (const omitted of DARK_OMITTED) {
      expect(tokens.colors.dark).not.toHaveProperty(omitted);
    }
  });
});

describe('Parity de tokens — :root espelha colorsLight (AC5.a)', () => {
  for (const [token, hex] of Object.entries(tokens.colors.light)) {
    const cssVar = toCssVarName(token);
    it(`${cssVar} em :root == colorsLight.${token} (${hex})`, () => {
      const cssValue = readVarInSelector(GLOBALS_CSS, ':root', cssVar);
      expect(cssValue, `CSS var ${cssVar} ausente em :root`).not.toBeNull();
      expect(normHex(cssValue as string)).toBe(normHex(hex));
    });
  }
});

describe('Parity de tokens — .dark espelha colorsDark (AC5.b)', () => {
  for (const [token, hex] of Object.entries(tokens.colors.dark)) {
    const cssVar = toCssVarName(token);
    it(`${cssVar} em .dark == colorsDark.${token} (${hex})`, () => {
      const cssValue = readVarInSelector(GLOBALS_CSS, '.dark', cssVar);
      expect(cssValue, `CSS var ${cssVar} ausente em .dark`).not.toBeNull();
      expect(normHex(cssValue as string)).toBe(normHex(hex));
    });
  }
});

describe('Parity de tokens — assimetria respeitada (PO-FIX-1)', () => {
  it('os 3 *Subtle de status existem em :root mas NÃO em .dark', () => {
    for (const omitted of DARK_OMITTED) {
      const cssVar = toCssVarName(omitted);
      // Presente em :root (modo claro).
      expect(readVarInSelector(GLOBALS_CSS, ':root', cssVar)).not.toBeNull();
      // Ausente em .dark (não inventado — Article IV).
      expect(readVarInSelector(GLOBALS_CSS, '.dark', cssVar)).toBeNull();
    }
  });

  it('globals.css migrou de @media para a classe .dark (DP-5.8.A)', () => {
    // Ignora comentários `/* ... */` (a migração é documentada num comentário).
    const cssNoComments = GLOBALS_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssNoComments).not.toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(cssNoComments).toMatch(/\.dark\s*\{/);
  });
});
