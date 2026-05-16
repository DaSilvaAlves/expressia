/**
 * Helpers de paginação cursor-based para endpoints de listagem.
 *
 * Cursor formato: base64-encoded JSON `{ last_due_date: ISO_date | null, last_id: uuid }`.
 * Estável em concurrent inserts (vs offset que pode dar duplicados/saltos).
 *
 * Trace: Story 3.2 AC6 + DP3-3.2 (cursor-based per Epic plan line 232).
 */
import { z } from 'zod';

export const CursorPayloadSchema = z.object({
  last_due_date: z.string().nullable(),
  last_id: z.string().uuid(),
});

export type CursorPayload = z.infer<typeof CursorPayloadSchema>;

/** Encode cursor para opaque base64 string para passar no response/query. */
export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decode opaque base64 cursor. Retorna null se inválido (cliente recebe
 * 400 VALIDATION_ERROR no handler de listagem).
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    const result = CursorPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
