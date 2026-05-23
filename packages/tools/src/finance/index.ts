/**
 * Barrel + side-effect registo das 5 tools cérebro do domínio Finanças.
 *
 * Story 4.10 — registo no `toolRegistry` singleton acontece em import-time
 * (side-effect). Stories consumidoras (2.5 Planner+Executor, 2.6 endpoint
 * `/api/agent/prompt`) importam este módulo indirectamente via
 * `@meu-jarvis/tools` → tools tornam-se imediatamente disponíveis ao Planner.
 *
 * Idempotência: `toolRegistry.register()` é idempotente por referência —
 * importar este módulo múltiplas vezes não causa `DuplicateToolError`.
 *
 * Trace: Story 4.10 AC6 + Story 3.8 AC5 (pattern) + Story 2.3 (toolRegistry foundation).
 */
// Imports relativos para a parent package — mesma constraint documentada em
// `tasks/index.ts:14-19`. Alias `@/` colide com aliases dos consumidores.
import { toolRegistry } from '../registry';

import { createCard } from './create-card';
import { createFinanceRecurrence } from './create-finance-recurrence';
import { createFinanceVariable } from './create-finance-variable';
import { createInstallment } from './create-installment';
import { queryFinanceSummary } from './query-finance-summary';

// Side-effect: regista as 5 tools no singleton.
toolRegistry.register(createFinanceVariable);
toolRegistry.register(createFinanceRecurrence);
toolRegistry.register(createCard);
toolRegistry.register(createInstallment);
toolRegistry.register(queryFinanceSummary);

export {
  createCard,
  createFinanceRecurrence,
  createFinanceVariable,
  createInstallment,
  queryFinanceSummary,
};
export type { CreateCardInput, CreateCardOutput } from './create-card';
export type {
  CreateFinanceRecurrenceInput,
  CreateFinanceRecurrenceOutput,
} from './create-finance-recurrence';
export type {
  CreateFinanceVariableInput,
  CreateFinanceVariableOutput,
} from './create-finance-variable';
export type {
  CreateInstallmentInput,
  CreateInstallmentOutput,
} from './create-installment';
export type {
  QueryFinanceSummaryInput,
  QueryFinanceSummaryOutput,
} from './query-finance-summary';
