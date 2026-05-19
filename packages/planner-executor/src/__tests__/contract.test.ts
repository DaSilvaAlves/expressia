/**
 * Tests de contrato (D6 mapping coverage + mock registry sanity).
 *
 * Trace: Story 2.5 AC2 + AC13.
 */
import { describe, expect, it } from 'vitest';

import { INTENT_VALUES } from '@meu-jarvis/classifier';

import { TOOL_TO_INTENT_MAP } from '@/schemas';
import { createMockRegistry } from '@/__fixtures__/mock-tool-registry';

describe('TOOL_TO_INTENT_MAP cobre 11 intents IntentSchema (D6)', () => {
  it('cada uma das 11 intents canónicas tem ≥1 tool name mapeado', () => {
    const intentsCovered = new Set(Object.values(TOOL_TO_INTENT_MAP));
    for (const intent of INTENT_VALUES) {
      expect(intentsCovered).toContain(intent);
    }
  });
});

describe('createMockRegistry sanity', () => {
  it('regista as 3 tools mock determinísticas (create_task, create_finance_variable, query_tasks)', () => {
    const registry = createMockRegistry();
    const all = registry.list();
    const names = all.map((t) => t.name).sort();
    expect(names).toEqual(['create_finance_variable', 'create_task', 'query_tasks']);
  });
});
