/**
 * Cifragem de tokens OAuth — AES-256-GCM (Story J-3 AC5).
 *
 * Cifra/decifra segredos (ex.: o `refresh_token` do Google OAuth) com
 * AES-256-GCM via `node:crypto` (stdlib — zero dependências externas). Cada
 * cifração gera um IV aleatório de 96 bits (12 bytes — tamanho recomendado para
 * GCM) e produz um `authTag` de 128 bits (16 bytes) que garante a integridade
 * na decifração (token adulterado → erro de autenticação).
 *
 * A chave de 32 bytes (256 bits) é lida de `OAUTH_TOKEN_ENCRYPTION_KEY`
 * (hex 64 chars OU base64), APENAS em runtime e dentro da função — nunca no
 * carregamento do módulo (para não crashar o servidor em arranque se a env var
 * faltar; a falha surge só quando a cifragem é efectivamente invocada).
 *
 * Restrições: chave nunca na DB, nunca em git, nunca em logs. O plaintext
 * decifrado deve ser descartado imediatamente após uso pelo chamador.
 *
 * Trace: Story J-3 AC5, PRD-Jarvis §4.4/§7 (segurança).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Erro tipado para falhas relacionadas com a chave/cifragem de tokens. */
export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCipherError';
  }
}

/** Resultado de uma cifração — todos os campos em base64. */
export interface EncryptedToken {
  /** Ciphertext AES-256-GCM em base64. */
  ciphertext: string;
  /** IV (12 bytes / 96 bits) em base64. */
  iv: string;
  /** Authentication tag GCM (16 bytes / 128 bits) em base64. */
  authTag: string;
}

const KEY_BYTES = 32; // 256 bits
const IV_BYTES = 12; // 96 bits (recomendado para GCM)
const ALGORITHM = 'aes-256-gcm' as const;

/**
 * Lê e valida a chave de cifragem de `OAUTH_TOKEN_ENCRYPTION_KEY`.
 *
 * Aceita hex (64 chars) ou base64. Aplica `.trim()` (robustez a whitespace
 * acidental na env var). Lança `TokenCipherError` se ausente ou se o tamanho
 * decifrado não for exactamente 32 bytes.
 */
function getKey(): Buffer {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new TokenCipherError(
      'OAUTH_TOKEN_ENCRYPTION_KEY não está definida — não é possível cifrar/decifrar tokens.',
    );
  }

  // Heurística de formato: 64 chars hex válidos → hex; caso contrário base64.
  const isHex = raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw);
  const key = Buffer.from(raw, isHex ? 'hex' : 'base64');

  if (key.length !== KEY_BYTES) {
    throw new TokenCipherError(
      `OAUTH_TOKEN_ENCRYPTION_KEY tem de ter ${KEY_BYTES} bytes (256 bits) — recebido ${key.length} bytes. Gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))".`,
    );
  }
  return key;
}

/**
 * Cifra `plaintext` com AES-256-GCM. Devolve ciphertext + IV + authTag em
 * base64. O IV é aleatório por chamada (nunca reutilizado).
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Decifra `ciphertext` (base64) com AES-256-GCM, verificando o `authTag`. Lança
 * `TokenCipherError` se a autenticação falhar (token adulterado, chave errada
 * ou IV/tag incorrectos).
 */
export function decryptToken(ciphertext: string, iv: string, authTag: string): string {
  const key = getKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    // `final()` lança se o authTag não validar — token adulterado ou chave/IV
    // errados. Normalizamos para o erro tipado (sem expor detalhes do crypto).
    throw new TokenCipherError(
      'Falha ao decifrar o token — autenticação GCM inválida (token adulterado ou chave incorrecta).',
    );
  }
}
