/**
 * Barrel + side-effect registo da gmail tool no `toolRegistry` singleton
 * (Story J-6).
 *
 * **Por que aqui e não no barrel `@meu-jarvis/tools`?** As tools de tasks/finance
 * registam-se em `packages/tools/src/index.ts`. A gmail tool NÃO pode viver em
 * `packages/tools` (precisa de `@/lib/google/oauth` de `apps/web` → criaria um
 * ciclo de dependência). Vive em `apps/web` e regista-se aqui, importando o MESMO
 * singleton `toolRegistry` de `@meu-jarvis/tools`. Mesma direcção que a calendar
 * tool (Story J-5).
 *
 * **FOOTGUN de tree-shaking:** este módulo é importado como side-effect
 * (`import '@/lib/agent/tools/gmail/index';`) em `run-agent.ts` E em
 * `confirm/route.ts` (os dois pontos onde o Planner/Executor corre). Imports
 * exclusivamente de side-effect podem ser eliminados por bundlers agressivos — a
 * regressão é detectada pelo teste `__tests__/registration.test.ts` (Tarefa 7.4).
 *
 * Idempotência: `toolRegistry.register()` é idempotente por referência — importar
 * este módulo por vários caminhos não causa `DuplicateToolError`.
 *
 * Trace: Story J-6 AC8.
 */
import { toolRegistry } from '@meu-jarvis/tools';

import { consultarEmails } from './list-emails';
import { enviarEmail } from './send-email';

// Side-effect: regista as gmail tools no singleton partilhado.
// `consultar_emails` (J-6, leitura) + `enviar_email` (J-7, escrita compose-only).
toolRegistry.register(consultarEmails);
toolRegistry.register(enviarEmail);

export { consultarEmails, enviarEmail };
export type { ConsultarEmailsInput, ConsultarEmailsOutput } from './list-emails';
export type { EnviarEmailInput, EnviarEmailOutput } from './send-email';
