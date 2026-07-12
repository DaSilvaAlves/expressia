// @vitest-environment node
/**
 * Testes do type guard `isTelegramUpdate` — foco Story V-1 (campo `voice`).
 *
 * O webhook recebe JSON arbitrário (input não confiável): o guard tem de aceitar
 * updates com `voice` bem-formado e rejeitar `voice` malformado, sem quebrar o
 * comportamento pré-V-1 (updates de texto / callback).
 */
import { describe, expect, it } from 'vitest';

import { isTelegramUpdate } from '@/lib/telegram/types';

const baseMessage = {
  message_id: 7,
  date: 1_700_000_000,
  chat: { id: 5647753194, type: 'private' },
};

describe('isTelegramUpdate — campo voice (Story V-1)', () => {
  it('aceita um update com voice válido (campos obrigatórios)', () => {
    const update = {
      update_id: 42,
      message: { ...baseMessage, voice: { file_id: 'abc123', duration: 5 } },
    };
    expect(isTelegramUpdate(update)).toBe(true);
  });

  it('aceita voice com mime_type e file_size opcionais bem tipados', () => {
    const update = {
      update_id: 42,
      message: {
        ...baseMessage,
        voice: {
          file_id: 'abc123',
          duration: 5,
          mime_type: 'audio/ogg',
          file_size: 12_345,
        },
      },
    };
    expect(isTelegramUpdate(update)).toBe(true);
  });

  it('rejeita voice sem file_id', () => {
    const update = {
      update_id: 42,
      message: { ...baseMessage, voice: { duration: 5 } },
    };
    expect(isTelegramUpdate(update)).toBe(false);
  });

  it('rejeita voice com duration não numérica', () => {
    const update = {
      update_id: 42,
      message: { ...baseMessage, voice: { file_id: 'abc', duration: '5' } },
    };
    expect(isTelegramUpdate(update)).toBe(false);
  });

  it('rejeita voice com file_size do tipo errado quando presente', () => {
    const update = {
      update_id: 42,
      message: {
        ...baseMessage,
        voice: { file_id: 'abc', duration: 5, file_size: 'grande' },
      },
    };
    expect(isTelegramUpdate(update)).toBe(false);
  });

  it('rejeita voice com mime_type do tipo errado quando presente', () => {
    const update = {
      update_id: 42,
      message: {
        ...baseMessage,
        voice: { file_id: 'abc', duration: 5, mime_type: 123 },
      },
    };
    expect(isTelegramUpdate(update)).toBe(false);
  });

  it('não regride: update de texto simples continua válido (sem voice)', () => {
    const update = {
      update_id: 42,
      message: { ...baseMessage, text: 'olá' },
    };
    expect(isTelegramUpdate(update)).toBe(true);
  });
});
