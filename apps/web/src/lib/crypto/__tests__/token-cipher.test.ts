// @vitest-environment node
/**
 * Testes unitários — token-cipher.ts (Story J-3 AC5/AC10).
 *
 * Ambiente `node` (não jsdom) — `node:crypto` puro, sem DOM. NÃO mockamos
 * `node:crypto`: a cifragem real é exercitada (encrypt → decrypt roundtrip,
 * integridade GCM).
 *
 * Casos críticos:
 *   - roundtrip encrypt/decrypt
 *   - erro com chave ausente
 *   - erro com chave de tamanho errado
 *   - decryptToken lança se authTag adulterado (integridade GCM)
 *   - plaintext vazio
 *   - plaintext com caracteres Unicode (PT-PT com acentos)
 *   - aceita chave em hex e em base64; tolera whitespace (.trim)
 */
import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptToken, encryptToken, TokenCipherError } from '@/lib/crypto/token-cipher';

/** Chave de 32 bytes em hex (64 chars) para os testes. */
const KEY_HEX = randomBytes(32).toString('hex');
/** A mesma chave em base64 (caminho alternativo de leitura). */
const KEY_BASE64 = Buffer.from(KEY_HEX, 'hex').toString('base64');

describe('token-cipher', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('com chave válida (hex)', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', KEY_HEX);
    });

    it('faz roundtrip encrypt → decrypt', () => {
      const plaintext = 'refresh-token-secreto-123';
      const { ciphertext, iv, authTag } = encryptToken(plaintext);

      expect(ciphertext).not.toBe(plaintext);
      expect(decryptToken(ciphertext, iv, authTag)).toBe(plaintext);
    });

    it('gera IV diferente a cada cifração (não determinístico)', () => {
      const a = encryptToken('mesmo-valor');
      const b = encryptToken('mesmo-valor');
      expect(a.iv).not.toBe(b.iv);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('cifra/decifra plaintext vazio', () => {
      const { ciphertext, iv, authTag } = encryptToken('');
      expect(decryptToken(ciphertext, iv, authTag)).toBe('');
    });

    it('cifra/decifra Unicode PT-PT (acentos, cedilha)', () => {
      const plaintext = 'configuração à pão coração — ção ñ €';
      const { ciphertext, iv, authTag } = encryptToken(plaintext);
      expect(decryptToken(ciphertext, iv, authTag)).toBe(plaintext);
    });

    it('decryptToken lança TokenCipherError se o authTag for adulterado', () => {
      const { ciphertext, iv, authTag } = encryptToken('valor-integro');
      // Inverte um byte do authTag (base64 → buffer → flip → base64).
      const tagBuf = Buffer.from(authTag, 'base64');
      tagBuf[0] = tagBuf[0]! ^ 0xff;
      const tamperedTag = tagBuf.toString('base64');

      expect(() => decryptToken(ciphertext, iv, tamperedTag)).toThrow(TokenCipherError);
    });

    it('decryptToken lança se o ciphertext for adulterado', () => {
      const { ciphertext, iv, authTag } = encryptToken('valor-integro');
      const ctBuf = Buffer.from(ciphertext, 'base64');
      ctBuf[0] = ctBuf[0]! ^ 0xff;
      const tampered = ctBuf.toString('base64');

      expect(() => decryptToken(tampered, iv, authTag)).toThrow(TokenCipherError);
    });
  });

  describe('com chave válida (base64)', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', KEY_BASE64);
    });

    it('aceita a chave em base64 e faz roundtrip', () => {
      const { ciphertext, iv, authTag } = encryptToken('via-base64');
      expect(decryptToken(ciphertext, iv, authTag)).toBe('via-base64');
    });
  });

  describe('robustez a whitespace', () => {
    beforeEach(() => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', `  ${KEY_HEX}\n`);
    });

    it('tolera whitespace à volta da chave (.trim)', () => {
      const { ciphertext, iv, authTag } = encryptToken('com-whitespace');
      expect(decryptToken(ciphertext, iv, authTag)).toBe('com-whitespace');
    });
  });

  describe('erros de configuração', () => {
    it('lança TokenCipherError se a chave estiver ausente', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', undefined);
      expect(() => encryptToken('x')).toThrow(TokenCipherError);
    });

    it('lança TokenCipherError se a chave for vazia (só whitespace)', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', '   ');
      expect(() => encryptToken('x')).toThrow(TokenCipherError);
    });

    it('lança TokenCipherError se a chave tiver tamanho errado', () => {
      vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', 'abcdef'); // 3 bytes — não 32
      expect(() => encryptToken('x')).toThrow(/32 bytes/);
    });
  });
});
