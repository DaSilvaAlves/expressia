// @vitest-environment node
/**
 * Testes — `scripts/audit-dark-mode.ts` (Story 5.8 AC3 / R-5.2 do Epic 5).
 *
 * O script vive na raiz do repo (`scripts/`), fora do `src/` de qualquer package
 * — é corrido via `tsx` no gate (`node scripts/audit-dark-mode.ts`). Para o testar
 * sem violar o `rootDir`/`include` do tsconfig do apps/web, importamo-lo em runtime
 * via `import()` dinâmico de um `file://` absoluto (não há import estático → o
 * typecheck não atravessa a fronteira do package).
 *
 * Cobertura (AC3 PASS):
 *   - `findViolationsInContent` DETECTA um literal com `bg-white` sem `dark:`
 *   - PASSA quando o mesmo elemento tem um `dark:` counterpart
 *   - PASSA em superfícies semi-transparentes (`bg-white/10` — glass, whitelist)
 *   - DETECTA `text-black` sem `dark:`; tons médios (`text-neutral-500`) não flagged
 *   - `runAudit()` sobre o codebase real → ZERO violações (gate verde)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/web/src/app/__tests__ → repo root → scripts/audit-dark-mode.ts
const SCRIPT_PATH = resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', 'audit-dark-mode.ts');

interface AuditModule {
  findViolationsInContent: (
    content: string,
    fileLabel: string,
  ) => Array<{ file: string; line: number; matched: string; snippet: string }>;
  runAudit: () => Array<{ file: string; line: number; matched: string }>;
}

let audit: AuditModule;

beforeAll(async () => {
  audit = (await import(pathToFileURL(SCRIPT_PATH).href)) as unknown as AuditModule;
});

describe('audit-dark-mode — detecção de violações (AC3.a)', () => {
  it('DETECTA bg-white sólido sem dark: counterpart', () => {
    const content = `const cls = "rounded bg-white p-4";`;
    const violations = audit.findViolationsInContent(content, 'mock.tsx');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.matched).toBe('bg-white');
    expect(violations[0]?.line).toBe(1);
  });

  it('PASSA quando o literal tem um dark: counterpart no mesmo elemento', () => {
    const content = `const cls = "bg-white dark:bg-surface p-4";`;
    expect(audit.findViolationsInContent(content, 'mock.tsx')).toHaveLength(0);
  });

  it('PASSA em bg-white/10 (semi-transparente — glass, whitelist DP-5.8.D)', () => {
    const content = `const cls = "bg-white/10 backdrop-blur";`;
    expect(audit.findViolationsInContent(content, 'mock.tsx')).toHaveLength(0);
  });

  it('DETECTA text-black sólido sem dark:', () => {
    const content = `const cls = "text-black font-bold";`;
    const violations = audit.findViolationsInContent(content, 'mock.tsx');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.matched).toBe('text-black');
  });

  it('DETECTA superfícies claras bg-gray-100 sem dark:', () => {
    const content = `const cls = "bg-gray-100 border";`;
    expect(audit.findViolationsInContent(content, 'mock.tsx')).toHaveLength(1);
  });

  it('NÃO flagged tons médios theme-agnósticos (text-neutral-500, bg-blue-600)', () => {
    const content = `const cls = "bg-blue-600 text-neutral-500";`;
    expect(audit.findViolationsInContent(content, 'mock.tsx')).toHaveLength(0);
  });

  it('reporta a linha correcta em conteúdo multi-linha', () => {
    const content = ['line one', 'const a = "text-black";', 'line three'].join('\n');
    const violations = audit.findViolationsInContent(content, 'mock.tsx');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
  });
});

describe('audit-dark-mode — gate sobre o codebase real (AC3.b / AC8.d)', () => {
  it('runAudit() devolve ZERO violações (gate verde)', () => {
    const violations = audit.runAudit();
    const summary = violations
      .map((v) => `${v.file}:${v.line} [${v.matched}]`)
      .join('\n');
    expect(violations, `Violações encontradas:\n${summary}`).toHaveLength(0);
  });
});
