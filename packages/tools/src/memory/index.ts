/**
 * Barrel + side-effect registo da tool do domínio Memória (Story M-1).
 *
 * O registo no `toolRegistry` singleton acontece em import-time (side-effect),
 * mesmo padrão de `packages/tools/src/tasks/index.ts`. Consumidores (Planner+
 * Executor, endpoint `/api/agent/prompt`) importam via `@meu-jarvis/tools` →
 * a tool `memorizar` fica imediatamente disponível ao Planner.
 *
 * Idempotência: `toolRegistry.register()` é idempotente por referência —
 * importar este módulo múltiplas vezes não causa `DuplicateToolError`.
 *
 * Trace: Story M-1 AC7 + Story 2.3 (toolRegistry foundation).
 */
// Imports relativos para a parent package — alias `@/` apenas funciona dentro
// do package tools próprio (vitest.config.ts). A constraint cross-package
// documentada em `tasks/index.ts` (boundary do `paths` alias do package db)
// aplica-se também aqui.
import { toolRegistry } from '../registry';

import { memorizar } from './memorizar';
import { esquecer } from './esquecer';
import { sugerirMemoria } from './sugerir-memoria';

// Side-effect: regista as tools do domínio `memory` no singleton.
toolRegistry.register(memorizar);
toolRegistry.register(esquecer);
toolRegistry.register(sugerirMemoria);

export { memorizar, esquecer, sugerirMemoria };
export type { MemorizarInput, MemorizarOutput } from './memorizar';
export type { EsquecerInput, EsquecerOutput } from './esquecer';
export type { SugerirMemoriaInput, SugerirMemoriaOutput } from './sugerir-memoria';
