/**
 * Testes unitários — oauth.ts (Story J-3 AC6).
 *
 * Cobre buildGoogleAuthUrl (scopes/params), exchangeCodeForTokens (sucesso,
 * falha HTTP, ausência de refresh_token, falha de transporte → GoogleOAuthError)
 * e refreshAccessToken (decifra → troca; decifração inválida → GoogleOAuthError).
 * Mocka `global.fetch`; a cifragem real é usada (roundtrip via token-cipher).
 */
import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encryptToken } from '@/lib/crypto/token-cipher';
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  GoogleOAuthError,
  refreshAccessToken,
} from '@/lib/google/oauth';

const KEY_HEX = randomBytes(32).toString('hex');

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('oauth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'client-123');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'secret-xyz');
    vi.stubEnv('SITE_URL', 'https://expressia.pt');
    vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', KEY_HEX);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('buildGoogleAuthUrl', () => {
    it('inclui scope calendar.events (escrita) + gmail.readonly + openid email, offline e prompt=consent (Story J-6)', () => {
      const url = buildGoogleAuthUrl();
      expect(url).toContain('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events');
      // Story J-6: scope Gmail readonly acumulado com o de Calendar.
      expect(url).toContain('gmail.readonly');
      // Story J-5: o scope de Calendar deixou de ser readonly — passou a permitir escrita.
      expect(url).not.toContain('calendar.readonly');
      expect(url).toContain('openid');
      expect(url).toContain('email');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexpressia.pt%2Fapi%2Fgoogle%2Fcallback');
    });

    it('ecoa o state quando fornecido', () => {
      expect(buildGoogleAuthUrl('abc')).toContain('state=abc');
    });

    it('lança GoogleOAuthError se o client_id faltar', () => {
      vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', undefined);
      expect(() => buildGoogleAuthUrl()).toThrow(GoogleOAuthError);
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('devolve tokens + email no caminho feliz', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600 }),
        )
        .mockResolvedValueOnce(jsonResponse({ email: 'eurico@gmail.com' }));

      const tokens = await exchangeCodeForTokens('code-abc');
      expect(tokens.accessToken).toBe('at-123');
      expect(tokens.refreshToken).toBe('rt-456');
      expect(tokens.email).toBe('eurico@gmail.com');
      expect(tokens.expiry.getTime()).toBeGreaterThan(Date.now());
    });

    it('lança GoogleOAuthError em HTTP não-OK', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, false, 400));
      await expect(exchangeCodeForTokens('bad')).rejects.toBeInstanceOf(GoogleOAuthError);
    });

    it('lança GoogleOAuthError se não vier refresh_token', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'at', expires_in: 3600 }));
      await expect(exchangeCodeForTokens('x')).rejects.toThrow(/refresh_token/);
    });

    it('normaliza falha de transporte para GoogleOAuthError', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
      await expect(exchangeCodeForTokens('x')).rejects.toBeInstanceOf(GoogleOAuthError);
    });
  });

  describe('refreshAccessToken', () => {
    it('decifra o refresh_token e troca por access_token novo', async () => {
      const { ciphertext, iv, authTag } = encryptToken('rt-original');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ access_token: 'novo-at', expires_in: 3600 }),
      );

      const result = await refreshAccessToken(ciphertext, iv, authTag);
      expect(result.accessToken).toBe('novo-at');

      // O body enviado contém o refresh_token decifrado.
      const [, init] = fetchMock.mock.calls[0]!;
      expect((init as RequestInit).body).toContain('refresh_token=rt-original');
    });

    it('lança GoogleOAuthError se a decifração falhar', async () => {
      await expect(
        refreshAccessToken('ciphertext-invalido', 'aXY=', 'dGFn'),
      ).rejects.toBeInstanceOf(GoogleOAuthError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
