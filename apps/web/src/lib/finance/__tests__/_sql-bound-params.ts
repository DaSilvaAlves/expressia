/**
 * Utilitário de teste partilhado (SEC-4) — extrai os parâmetros bound de um
 * objecto `SQL` do Drizzle (tagged template literal). Usado pelos testes dos 6
 * helpers de `lib/finance` para provar que o `household_id` autenticado é
 * interpolado como parâmetro bound em cada query (1.ª rede — isolamento
 * app-enforced). Espelha `boundParamValues` de
 * `app/api/financas/contas/__tests__/route.test.ts` (SEC-1 AC-K2).
 *
 * Ficheiro sem sufixo `.test.` — NÃO é colectado como suite pelo Vitest, apenas
 * importado pelos testes.
 *
 * Estrutura do Drizzle `SQL`: `queryChunks` alterna entre `StringChunk` (objecto
 * com `.value: string[]`, texto SQL) e os parâmetros bound (valores primitivos
 * directos, ou `SQL` aninhado com o seu próprio `queryChunks`).
 */
export function boundParamValues(sqlObj: unknown): unknown[] {
  const out: unknown[] = [];
  const walkChunks = (chunks: unknown): void => {
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk != null && typeof chunk === 'object') {
        const obj = chunk as Record<string, unknown>;
        if ('queryChunks' in obj) {
          walkChunks(obj.queryChunks); // SQL aninhado
        }
        // StringChunk (`.value` array) é texto SQL, não parâmetro — ignorar.
      } else {
        // Valor primitivo no topo de queryChunks = parâmetro bound.
        out.push(chunk);
      }
    }
  };
  if (sqlObj != null && typeof sqlObj === 'object' && 'queryChunks' in (sqlObj as object)) {
    walkChunks((sqlObj as { queryChunks: unknown }).queryChunks);
  }
  return out;
}
