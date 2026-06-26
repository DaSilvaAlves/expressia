/**
 * Google OAuth 2.0 — fluxo readonly do Calendar (Story J-3 AC6).
 *
 * Implementa o fluxo OAuth single-user até à camada de tokens:
 *   - `buildGoogleAuthUrl()` — URL de consentimento (scope `calendar.readonly`,
 *     `access_type=offline` + `prompt=consent` para forçar `refresh_token`).
 *   - `exchangeCodeForTokens(code)` — troca o código de autorização por tokens.
 *   - `refreshAccessToken(...)` — decifra o `refresh_token` em memória, troca por
 *     `access_token` novo, e descarta o `refresh_token` decifrado imediatamente.
 *
 * DECISÃO DE DEPENDÊNCIA (fetch nativo vs googleapis) — ver Dev Agent Record da
 * Story J-3. Escolha: `fetch` nativo ao token endpoint do Google
 * (`https://oauth2.googleapis.com/token`). Razão: alinhado com J-1/J-2 (que
 * usaram fetch), zero dependência nova pesada, e os dois únicos endpoints
 * necessários (token exchange + token refresh) são triviais via `fetch`. O
 * `googleapis` traria centenas de KB de superfície de API não utilizada.
 *
 * Credenciais de `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (Vercel
 * Env UE — nunca em git). O `redirect_uri` deriva de `SITE_URL` (padrão SEC-9).
 *
 * Restrições: o `refresh_token` decifrado nunca é persistido além do tempo de
 * execução de `refreshAccessToken`, nunca é logado.
 *
 * Trace: Story J-3 AC6, PRD-Jarvis §4.4 (OAuth), FR-J9.
 */
import { decryptToken } from '@/lib/crypto/token-cipher';

/** Erro tipado para falhas do fluxo OAuth Google. */
export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/**
 * Scopes pedidos no consentimento. `calendar.events` (Story J-5 — leitura E
 * escrita de eventos do calendário; superset de `calendar.readonly` para
 * eventos do calendário primário) + `openid email` para obter o email da conta
 * Google (referência informativa em `google_oauth_tokens.google_email`). Sem
 * `openid email`, o `userinfo` endpoint não devolveria o email.
 *
 * Story J-5 AC4: actualizado de `calendar.readonly` → `calendar.events`. A
 * leitura do brief diário (J-4 `getCalendarEventsToday`) continua a funcionar
 * com o novo token (scope mais permissivo, não restritivo). Exige
 * re-consentimento one-shot do Eurico (Tarefa 9 — Google obriga nova
 * autorização quando os scopes aumentam).
 */
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/calendar.events openid email';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Path do callback OAuth — espelhado nos Authorized redirect URIs do Google. */
const OAUTH_CALLBACK_PATH = '/api/google/callback';

/** Resultado de uma troca de código por tokens. */
export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  expiry: Date;
  email: string;
}

/** Resultado de um refresh de access token. */
export interface RefreshedAccessToken {
  accessToken: string;
  expiry: Date;
}

function getClientId(): string {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  if (!id) {
    throw new GoogleOAuthError('GOOGLE_OAUTH_CLIENT_ID não está definida.');
  }
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!secret) {
    throw new GoogleOAuthError('GOOGLE_OAUTH_CLIENT_SECRET não está definida.');
  }
  return secret;
}

/**
 * Deriva o `redirect_uri` absoluto a partir de `SITE_URL` (padrão SEC-9 —
 * `if (siteUrl)` truthy, sem barra final). Em ausência, fallback de dev.
 */
function getRedirectUri(): string {
  const siteUrl = process.env.SITE_URL?.trim();
  const base = siteUrl ? siteUrl.replace(/\/$/, '') : 'http://localhost:3000';
  return `${base}${OAUTH_CALLBACK_PATH}`;
}

/**
 * Constrói o URL de consentimento OAuth do Google.
 *
 * `access_type=offline` + `prompt=consent` garantem a emissão de um
 * `refresh_token` (sem `prompt=consent`, re-autorizações não devolvem novo
 * refresh token).
 *
 * @param state - valor opcional anti-CSRF a ecoar no callback.
 */
export function buildGoogleAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  if (state) {
    params.set('state', state);
  }
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Shape mínima da resposta de token do Google que consumimos. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
}

function isTokenResponse(value: unknown): value is GoogleTokenResponse {
  return typeof value === 'object' && value !== null;
}

/** Calcula o instante de expiração a partir de `expires_in` (segundos). */
function expiryFromSeconds(expiresIn: number | undefined): Date {
  // Default conservador de 3600s (1h) se o Google não enviar `expires_in`.
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600;
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Lê o email da conta Google a partir do `userinfo` endpoint (best-effort).
 * Falha de rede/parse → string vazia (o email é apenas referência informativa).
 */
async function fetchGoogleEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return '';
    }
    const data: unknown = await res.json();
    if (typeof data === 'object' && data !== null && 'email' in data) {
      const email = (data as { email?: unknown }).email;
      return typeof email === 'string' ? email : '';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Troca o código de autorização OAuth por tokens (`access_token` +
 * `refresh_token`). Lança `GoogleOAuthError` se a troca falhar ou se o Google
 * não devolver `refresh_token` (sinaliza ausência de `prompt=consent`).
 */
export async function exchangeCodeForTokens(code: string): Promise<ExchangedTokens> {
  const body = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    // Falha de transporte (rede/DNS) — normaliza para o erro tipado.
    throw new GoogleOAuthError(
      `Troca de código OAuth falhou no transporte: ${err instanceof Error ? err.message : 'erro de rede'}.`,
    );
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok || !isTokenResponse(json)) {
    throw new GoogleOAuthError(
      `Troca de código OAuth falhou (HTTP ${res.status}). Verifica as credenciais e o redirect URI.`,
    );
  }

  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = json;

  if (!accessToken) {
    throw new GoogleOAuthError('Resposta do Google sem access_token.');
  }
  if (!refreshToken) {
    throw new GoogleOAuthError(
      'Resposta do Google sem refresh_token — o consentimento tem de usar access_type=offline & prompt=consent.',
    );
  }

  const email = await fetchGoogleEmail(accessToken);

  return {
    accessToken,
    refreshToken,
    expiry: expiryFromSeconds(expiresIn),
    email,
  };
}

/**
 * Decifra o `refresh_token` em memória e troca-o por um `access_token` novo.
 *
 * O `refresh_token` decifrado vive APENAS dentro desta função (variável local
 * `plainRefreshToken`) e nunca é logado nem devolvido — só o `access_token`
 * resultante. Lança `GoogleOAuthError` se a decifração ou o refresh falharem.
 */
export async function refreshAccessToken(
  encryptedRefreshToken: string,
  iv: string,
  authTag: string,
): Promise<RefreshedAccessToken> {
  // Decifrado em memória — descartado ao sair do escopo da função. Falha de
  // decifração (TokenCipherError) é normalizada para GoogleOAuthError.
  let plainRefreshToken: string;
  try {
    plainRefreshToken = decryptToken(encryptedRefreshToken, iv, authTag);
  } catch (err) {
    throw new GoogleOAuthError(
      `Não foi possível decifrar o refresh_token: ${err instanceof Error ? err.message : 'erro de cifragem'}.`,
    );
  }

  const body = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    refresh_token: plainRefreshToken,
    grant_type: 'refresh_token',
  });

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new GoogleOAuthError(
      `Refresh do access_token falhou no transporte: ${err instanceof Error ? err.message : 'erro de rede'}.`,
    );
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok || !isTokenResponse(json) || !json.access_token) {
    throw new GoogleOAuthError(
      `Refresh do access_token falhou (HTTP ${res.status}). O refresh_token pode ter sido revogado.`,
    );
  }

  return {
    accessToken: json.access_token,
    expiry: expiryFromSeconds(json.expires_in),
  };
}
