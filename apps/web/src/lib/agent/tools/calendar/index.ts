/**
 * Barrel + side-effect registo das 2 calendar tools no `toolRegistry` singleton
 * (Story J-5).
 *
 * **Por que aqui e não no barrel `@meu-jarvis/tools`?** As tools de tasks/finance
 * registam-se em `packages/tools/src/index.ts`. As calendar tools NÃO podem viver
 * em `packages/tools` (precisam de `@/lib/google/oauth` de `apps/web` → criaria
 * um ciclo de dependência). Vivem em `apps/web` e registam-se aqui, importando o
 * MESMO singleton `toolRegistry` de `@meu-jarvis/tools`.
 *
 * **FOOTGUN de tree-shaking:** este módulo é importado como side-effect
 * (`import '@/lib/agent/tools/calendar/index';`) em `run-agent.ts` E em
 * `confirm/route.ts` (os dois pontos onde o Planner/Executor corre). Imports
 * exclusivamente de side-effect podem ser eliminados por bundlers agressivos — a
 * regressão é detectada pelo teste `__tests__/registration.test.ts` (Tarefa 7.6).
 *
 * Idempotência: `toolRegistry.register()` é idempotente por referência — importar
 * este módulo por vários caminhos não causa `DuplicateToolError`.
 *
 * Trace: Story J-5 AC10.
 */
import { toolRegistry } from '@meu-jarvis/tools';

import { criarEventoCalendario } from './create-calendar-event';
import { reagendarEventoCalendario } from './update-calendar-event';

// Side-effect: regista as calendar tools no singleton partilhado.
toolRegistry.register(criarEventoCalendario);
toolRegistry.register(reagendarEventoCalendario);

export { criarEventoCalendario, reagendarEventoCalendario };
export type {
  CriarEventoCalendarioInput,
  CriarEventoCalendarioOutput,
} from './create-calendar-event';
export type {
  ReagendarEventoCalendarioInput,
  ReagendarEventoCalendarioOutput,
} from './update-calendar-event';
