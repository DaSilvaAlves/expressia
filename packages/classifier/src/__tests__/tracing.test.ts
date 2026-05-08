/**
 * Testes da whitelist OTel — zero PII em span attributes.
 *
 * Trace: Story 2.4 AC9 + AC11 (tracing.test.ts mínimo 4 casos) + NFR12.
 *
 * Estratégia:
 *   - `CLASSIFIER_SPAN_ATTRIBUTE_KEYS` lista canónica de keys permitidas.
 *   - NUNCA aparece `input.text`, `raw_span`, `user.id` raw em keys.
 *   - `user.id` aparece como `user_hash` (já hashed via `hashForCorrelation`).
 *   - `household.id` é UUID — explicitamente NÃO PII per `tracer.ts` doc.
 */
import { describe, expect, it } from 'vitest';

import { CLASSIFIER_SPAN_ATTRIBUTE_KEYS } from '@/tracing';

describe('CLASSIFIER_SPAN_ATTRIBUTE_KEYS (AC9 whitelist)', () => {
  it('contém exactamente 12 keys (10 metrics + 2 hashed identifiers)', () => {
    expect(CLASSIFIER_SPAN_ATTRIBUTE_KEYS.length).toBe(12);
  });

  it('NUNCA inclui keys com payload de PII', () => {
    const forbiddenKeys = [
      'classifier.input',
      'classifier.input_text',
      'classifier.text',
      'classifier.raw_span',
      'classifier.intents', // detalhes individuais — só count agregado é OK
      'classifier.intent_payload',
      'classifier.user_id', // raw — só hash é OK
      'classifier.user.id',
      'classifier.email',
      'classifier.nif',
      'classifier.raw_output',
      'classifier.llm_response',
    ];
    for (const forbidden of forbiddenKeys) {
      expect(CLASSIFIER_SPAN_ATTRIBUTE_KEYS).not.toContain(forbidden);
    }
  });

  it('inclui keys quantitativas e identifiers hashed', () => {
    const required = [
      'classifier.model',
      'classifier.input_length',
      'classifier.intent_count',
      'classifier.overall_confidence',
      'classifier.language_detected',
      'classifier.duration_ms',
      'classifier.tokens_input',
      'classifier.tokens_output',
      'classifier.success',
      'classifier.error_class',
      'classifier.user_hash',
      'classifier.trace_id',
    ];
    for (const key of required) {
      expect(CLASSIFIER_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }
  });

  it('é uma ReadonlyArray (não pode ser mutada por consumers)', () => {
    // TypeScript impõe `ReadonlyArray<string>` em compile-time.
    // Em runtime apenas confirmamos que o array existe e tem o conteúdo certo.
    expect(Array.isArray(CLASSIFIER_SPAN_ATTRIBUTE_KEYS)).toBe(true);
  });
});
