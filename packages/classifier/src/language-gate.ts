/**
 * Language gate PT-PT — detecção heurística pré-LLM via lista conservadora de
 * padrões inequivocamente NÃO-PT-PT.
 *
 * Trace: Story 2.4 AC6; CON3 (PT-PT exclusivo); NFR12 (não logar input);
 *        `language-standards.md` (vocabulário PT-BR proibido).
 *
 * Princípios [AUTO-DECISION D3 do @sm, validada por @po]:
 *   - Sem ML — regex determinística, testável, poupa tokens OpenAI.
 *   - **Conservadora** — falsos negativos (PT-PT enviado ao LLM) são aceites;
 *     falsos positivos (PT-PT rejeitado) são INACEITÁVEIS.
 *   - Lista pequena de padrões INEQUIVOCAMENTE estrangeiros. Quando há
 *     ambiguidade (palavras que existem em ambas as variantes), preferir
 *     ENVIAR ao LLM e deixá-lo decidir.
 *   - Match case-insensitive com word boundaries para evitar falsos positivos
 *     dentro de palavras compostas (ex: "voceiro" não deve match "voce").
 *
 * **Não usar fora desta package** — exportada apenas para testabilidade e
 * uso futuro pela Story 2.5 (Planner pode querer rejeitar prompts non-PT-PT
 * directamente).
 */

/**
 * Resultado do language gate. `detectedPatterns` lista os padrões NÃO-PT-PT
 * encontrados (para debug e construção de `ClassifierLanguageError`).
 */
export interface LanguageGateResult {
  readonly isPortugueseEuropean: boolean;
  readonly detectedPatterns: ReadonlyArray<string>;
}

/**
 * Padrões inequivocamente NÃO-PT-PT — evidências fortes de PT-BR, EN ou ES.
 *
 * Critérios para incluir um padrão:
 *   1. Palavra/sequência usada SISTEMATICAMENTE em PT-BR/EN/ES e RARAMENTE em
 *      PT-PT formal/informal.
 *   2. Não tem homógrafa comum em PT-PT que cause falso positivo.
 *   3. Match com Unicode-aware boundaries — JavaScript `\b` falha com chars
 *      como `ê`, `é`, `ô` (não são `\w` ASCII). Usamos lookbehind/lookahead
 *      `(?<![\p{L}])` / `(?![\p{L}])` com flag `u` para boundaries que
 *      respeitam todos os letters Unicode.
 *
 * Lista intencionalmente PEQUENA (não busca cobertura 100%) — um simples
 * "deletar" ou "you" basta para rejeitar; ambiguidade vai para o LLM.
 */
function unicodeWordPattern(word: string): RegExp {
  return new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, 'iu');
}

const NON_PT_PT_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // PT-BR — pronomes e formas verbais que não existem em PT-PT
  { pattern: unicodeWordPattern('voc[êe]'), label: 'pt-br:voce' },
  { pattern: unicodeWordPattern('deletar'), label: 'pt-br:deletar' },
  { pattern: unicodeWordPattern('checar'), label: 'pt-br:checar' },
  { pattern: unicodeWordPattern('printar'), label: 'pt-br:printar' },
  { pattern: unicodeWordPattern('planilha'), label: 'pt-br:planilha' },
  { pattern: unicodeWordPattern('geladeira'), label: 'pt-br:geladeira' },
  { pattern: unicodeWordPattern('ônibus'), label: 'pt-br:onibus' },
  { pattern: unicodeWordPattern('trem'), label: 'pt-br:trem' },
  // EN — palavras gramaticais comuns
  { pattern: unicodeWordPattern('the'), label: 'en:the' },
  { pattern: unicodeWordPattern('(?:is|are|was|were)'), label: 'en:be' },
  { pattern: unicodeWordPattern('you'), label: 'en:you' },
  { pattern: unicodeWordPattern('what'), label: 'en:what' },
  { pattern: unicodeWordPattern('where'), label: 'en:where' },
  { pattern: unicodeWordPattern('when'), label: 'en:when' },
  // ES — diacríticos invertidos e pronomes inequívocos
  { pattern: /[¿¡]/, label: 'es:invertedpunct' },
  { pattern: unicodeWordPattern('usted'), label: 'es:usted' },
  { pattern: unicodeWordPattern('(?:qué|cómo|dónde)'), label: 'es:interrogative' },
  { pattern: unicodeWordPattern('ahora'), label: 'es:ahora' },
  { pattern: unicodeWordPattern('muy'), label: 'es:muy' },
];

/**
 * Detecta se o `text` aparenta NÃO ser português europeu.
 *
 * - Vazio/whitespace → `isPortugueseEuropean: true` (validação separada
 *   apanha em `Classifier.classify()`).
 * - Match com qualquer padrão da lista → `isPortugueseEuropean: false`.
 * - Caso contrário → `isPortugueseEuropean: true`.
 *
 * Caller responsável por:
 *   - Tratar `false` como sinal para retornar `unknown` sem chamar LLM
 *     (lança `ClassifierLanguageError` severity `warn`).
 *   - Tratar `true` como prossegue para LLM.
 */
export function detectNonPtPt(text: string): LanguageGateResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { isPortugueseEuropean: true, detectedPatterns: [] };
  }

  const detectedPatterns: string[] = [];
  for (const { pattern, label } of NON_PT_PT_PATTERNS) {
    if (pattern.test(text)) {
      detectedPatterns.push(label);
    }
  }

  return {
    isPortugueseEuropean: detectedPatterns.length === 0,
    detectedPatterns,
  };
}
