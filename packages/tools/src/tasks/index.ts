/**
 * Barrel + side-effect registo das 4 tools cérebro do domínio Tarefas.
 *
 * Story 3.8 — registo no `toolRegistry` singleton acontece em import-time
 * (side-effect). Stories consumidoras (2.5 Planner+Executor, 2.6 endpoint
 * `/api/agent/prompt`) importam este módulo indirectamente via
 * `@meu-jarvis/tools` → tools tornam-se imediatamente disponíveis ao Planner.
 *
 * Idempotência: `toolRegistry.register()` é idempotente por referência —
 * importar este módulo múltiplas vezes não causa `DuplicateToolError`.
 *
 * Trace: Story 3.8 AC5 + Story 2.3 (toolRegistry foundation).
 */
// Imports relativos para a parent package — alias `@/` apenas funciona dentro
// do package tools próprio (vitest.config.ts). Quando consumido por apps/web,
// o resolver vitest cai no alias `@/` do app e quebra. Constitution Article VI
// recomenda absolutos, mas a constraint cross-package documentada em
// `contracts.ts` (boundary do `paths` alias do package db) força esta excepção
// dentro do package tools.
import { toolRegistry } from '../registry';

import { completarTarefa } from './completar-tarefa';
import { criarTarefa } from './criar-tarefa';
import { listarAtrasadas } from './listar-atrasadas';
import { listarTarefas } from './listar-tarefas';

// Side-effect: regista as 4 tools no singleton.
toolRegistry.register(criarTarefa);
toolRegistry.register(completarTarefa);
toolRegistry.register(listarTarefas);
toolRegistry.register(listarAtrasadas);

export { completarTarefa, criarTarefa, listarAtrasadas, listarTarefas };
export type {
  CompletarTarefaInput,
  CompletarTarefaOutput,
} from './completar-tarefa';
export type { CriarTarefaInput, CriarTarefaOutput } from './criar-tarefa';
export type {
  ListarAtrasadasInput,
  ListarAtrasadasOutput,
} from './listar-atrasadas';
export type {
  ListarTarefasInput,
  ListarTarefasOutput,
} from './listar-tarefas';
