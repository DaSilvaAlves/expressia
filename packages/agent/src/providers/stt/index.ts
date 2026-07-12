/**
 * Factory do provider STT (Story V-1 AC4/AC5).
 *
 * `getSttProvider()` devolve um singleton lazy do `GoogleSpeechProvider`,
 * construído a partir da service-account em `STT_SERVICE_ACCOUNT_JSON` (Vercel
 * Env UE — nunca em git, mesma disciplina de `TELEGRAM_BOT_TOKEN`/
 * `OAUTH_TOKEN_ENCRYPTION_KEY`). O webhook consome só a interface, sem conhecer o
 * provider concreto — trocar de fornecedor não obriga a mexer no webhook.
 *
 * O valor do segredo pode ser o JSON da chave em claro OU codificado em base64
 * (recomendado em Vercel Env, evita problemas com quebras de linha na chave
 * privada). Overrides opcionais: `STT_GCP_PROJECT`, `STT_REGION`, `STT_MODEL`.
 */
import { GoogleSpeechProvider, type ServiceAccountKey } from './google-speech';
import { SttError, type SttProviderInterface } from './interface';

let cached: SttProviderInterface | null = null;

/** Reset do singleton — usado em testes. */
export function resetSttProviderCache(): void {
  cached = null;
}

function isServiceAccountKey(value: unknown): value is ServiceAccountKey {
  if (typeof value !== 'object' || value === null) return false;
  const key = value as Record<string, unknown>;
  return typeof key.client_email === 'string' && typeof key.private_key === 'string';
}

/**
 * Lê e faz parse da service-account de `STT_SERVICE_ACCOUNT_JSON` (JSON em claro
 * ou base64). Lança `SttError` (falha de configuração) se ausente ou inválida.
 */
function loadServiceAccountFromEnv(): ServiceAccountKey {
  const raw = process.env.STT_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new SttError('STT_SERVICE_ACCOUNT_JSON não está definida.');
  }
  // Aceita JSON em claro (começa por `{`) ou base64 do JSON.
  const jsonText = raw.startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SttError('STT_SERVICE_ACCOUNT_JSON não é um JSON válido.');
  }
  if (!isServiceAccountKey(parsed)) {
    throw new SttError('STT_SERVICE_ACCOUNT_JSON sem client_email/private_key.');
  }
  return parsed;
}

/**
 * Devolve o provider STT (singleton lazy). Lança `SttError` se o segredo estiver
 * ausente/malformado — o webhook apanha e degrada graciosamente.
 */
export function getSttProvider(): SttProviderInterface {
  if (cached) {
    return cached;
  }
  const serviceAccount = loadServiceAccountFromEnv();
  cached = new GoogleSpeechProvider({
    serviceAccount,
    project: process.env.STT_GCP_PROJECT?.trim() || undefined,
    region: process.env.STT_REGION?.trim() || undefined,
    model: process.env.STT_MODEL?.trim() || undefined,
  });
  return cached;
}

export { GoogleSpeechProvider } from './google-speech';
export { SttError } from './interface';
export type { SttProviderInterface } from './interface';
export type { ServiceAccountKey } from './google-speech';
