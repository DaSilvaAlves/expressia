#!/usr/bin/env tsx
/**
 * Dark Mode Audit Gate — Story 5.8 (R-5.2 do Epic 5, AC3).
 *
 * Detecta classes Tailwind de cor CLARA que NÃO têm um `dark:` counterpart no
 * mesmo `className`, e que portanto ficariam visualmente partidas em modo escuro
 * (ex.: um `bg-white` sem `dark:bg-...` = card branco sobre fundo escuro).
 *
 * Algoritmo:
 *   1. Lê todos os `.tsx` em `apps/web/src` + `packages/ui/src` (exclui testes).
 *   2. Extrai cada literal de `className` (strings entre aspas/template).
 *   3. Para cada literal, procura tokens de cor clara "partidora" (whitelist de
 *      padrões abaixo). Se o literal NÃO contém nenhuma variante `dark:`, é
 *      reportado como violação (ficheiro:linha + classe).
 *   4. Exit 0 se zero violações; exit 1 caso contrário.
 *
 * Filosofia da whitelist (DP-5.8.D — bounded sweep, não exaustivo):
 *   - SÓ classes que QUEBRAM em dark mode são flagged: superfícies claras
 *     (`bg-white`, `bg-{gray|slate|zinc|neutral}-{50,100,200}`) e texto escuro
 *     (`text-black`, `text-{...}-{900,950}`).
 *   - Tons médios (`text-neutral-500`, `bg-blue-600`) são theme-agnósticos
 *     (legíveis em ambos os modos) → NÃO flagged.
 *   - Classes com opacidade (`bg-white/10`, `bg-black/5`) são semi-transparentes
 *     (glass effects) → whitelist legítima (front-end-spec).
 *   - Cores de marca em botões (`bg-blue-600 text-white`) → não flagged.
 *
 * Uso:
 *   tsx scripts/audit-dark-mode.ts
 *   node --import tsx scripts/audit-dark-mode.ts
 *
 * Trace: Story 5.8 AC3/AC8.d; Epic 5 R-5.2.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SCAN_DIRS = [
  join(REPO_ROOT, 'apps', 'web', 'src'),
  join(REPO_ROOT, 'packages', 'ui', 'src'),
];

/**
 * Padrões de classe "partidora de dark mode" — superfícies claras + texto
 * escuro. Cada regex casa o token Tailwind isolado (com word boundaries).
 * NÃO casa variantes com opacidade (`/N`) nem prefixos `dark:` (tratados à parte).
 */
const BREAKING_PATTERNS: ReadonlyArray<RegExp> = [
  /\bbg-white\b(?!\/)/, // bg-white sólido (sem opacidade)
  /\btext-black\b(?!\/)/, // text-black sólido
  /\bbg-(?:gray|slate|zinc|neutral)-(?:50|100|200)\b(?!\/)/, // superfícies claras
  /\btext-(?:gray|slate|zinc|neutral)-(?:900|950)\b(?!\/)/, // texto muito escuro
];

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly matched: string;
}

/**
 * Extrai violações de uma única string de conteúdo (testável isoladamente).
 * Heurística: opera por `className="..."` / `className={'...'}` / template
 * literals — qualquer literal de string que contenha um token partidor SEM
 * nenhuma variante `dark:` no mesmo literal é uma violação.
 */
export function findViolationsInContent(
  content: string,
  fileLabel: string,
): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  // Captura literais de string (aspas simples/duplas/backtick). Suficiente para
  // className inline e constantes de classe (precedente do codebase).
  const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

  lines.forEach((lineText, idx) => {
    let m: RegExpExecArray | null;
    STRING_LITERAL.lastIndex = 0;
    while ((m = STRING_LITERAL.exec(lineText)) !== null) {
      const literal = m[2] ?? '';
      // Só interessam literais com aspecto de lista de classes Tailwind.
      if (!/\b(?:bg|text|border)-/.test(literal)) continue;
      // Se o literal já tem uma variante dark:, considera-se coberto.
      const hasDarkVariant = /\bdark:/.test(literal);
      if (hasDarkVariant) continue;

      for (const pattern of BREAKING_PATTERNS) {
        const hit = pattern.exec(literal);
        if (hit) {
          violations.push({
            file: fileLabel,
            line: idx + 1,
            snippet: literal.length > 80 ? `${literal.slice(0, 77)}...` : literal,
            matched: hit[0],
          });
          break; // uma violação por literal é suficiente para reportar
        }
      }
    }
  });

  return violations;
}

/** Recolhe recursivamente os `.tsx` a auditar (exclui `__tests__` e `.test.`). */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...collectFiles(full));
    } else if (
      entry.endsWith('.tsx') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Corre a auditoria sobre os SCAN_DIRS. Retorna todas as violações. */
export function runAudit(): Violation[] {
  const all: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const content = readFileSync(file, 'utf8');
      const label = relative(REPO_ROOT, file).split('\\').join('/');
      all.push(...findViolationsInContent(content, label));
    }
  }
  return all;
}

/** Entry point CLI — só corre quando invocado directamente (não em import). */
function main(): void {
  const violations = runAudit();
  if (violations.length === 0) {
    console.log('[audit-dark-mode] OK — zero violações de dark mode.');
    process.exit(0);
  }
  console.error(
    `[audit-dark-mode] ${violations.length} violação(ões) — classes de cor clara sem dark: counterpart:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.matched}]  ${v.snippet}`);
  }
  console.error(
    '\nCorrige adicionando um `dark:` counterpart ou usando um token semântico (ex.: bg-surface, text-foreground).',
  );
  process.exit(1);
}

// `import.meta.url` === o módulo invocado directamente → corre o CLI.
const invokedDirectly =
  process.argv[1] != null &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main();
}
