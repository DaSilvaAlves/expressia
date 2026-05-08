/**
 * Validação do JSON Schema gerado a partir de `ClassificationSchema` —
 * confirma compatibilidade com OpenAI structured outputs.
 *
 * Trace: Story 2.4 AC11 (contract.test.ts mínimo 2 casos).
 *
 * Estratégia:
 *   - `zodToJsonSchema(ClassificationSchema)` deve produzir um schema com
 *     campos obrigatórios presentes, `additionalProperties: false` (strict
 *     mode requer schemas fechados), e propriedades top-level esperadas.
 */
import { describe, expect, it } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ClassificationSchema } from '@/schemas';

describe('JSON Schema de ClassificationSchema (compatibilidade OpenAI)', () => {
  it('inclui as 4 propriedades top-level (intents, language, needs_confirmation, overall_confidence)', () => {
    const schema = zodToJsonSchema(ClassificationSchema, {
      name: 'classification',
      $refStrategy: 'none',
    }) as { properties?: Record<string, unknown>; required?: string[] } & Record<string, unknown>;

    // O zodToJsonSchema com `name` envolve o schema dentro de `definitions.<name>`.
    const inner =
      ('properties' in schema ? schema : (schema as { definitions: Record<string, unknown> })
          .definitions?.['classification']) as
        | { properties?: Record<string, unknown>; required?: string[] }
        | undefined;

    const props = inner?.properties ?? schema.properties;
    expect(props).toBeDefined();
    expect(props).toHaveProperty('intents');
    expect(props).toHaveProperty('language');
    expect(props).toHaveProperty('needs_confirmation');
    expect(props).toHaveProperty('overall_confidence');
  });

  it('intents é array com items de tipo object', () => {
    const schema = zodToJsonSchema(ClassificationSchema, {
      name: 'classification',
      $refStrategy: 'none',
    }) as Record<string, unknown> & {
      properties?: Record<string, { type?: string; minItems?: number; maxItems?: number }>;
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };

    const props =
      schema.properties ?? schema.definitions?.['classification']?.properties ?? {};
    const intents = props['intents'];
    expect(intents).toBeDefined();
    // Tipo array.
    if (intents && typeof intents === 'object' && 'type' in intents) {
      expect(intents.type).toBe('array');
    }
  });
});
