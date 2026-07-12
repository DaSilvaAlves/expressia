/**
 * Testes do provider STT Google Cloud Speech-to-Text v2 (Story V-1 AC4).
 *
 * O JWT é assinado com uma chave RSA real (gerada em runtime) — o passo de
 * assinatura corre a sério; só o `fetch` (token endpoint + recognize) é mockado.
 * Nunca há rede real. Cobrem-se sucesso e falhas (rede, quota, resposta vazia) +
 * o factory `getSttProvider` (parse do segredo de env).
 */
import crypto from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleSpeechProvider } from '../../providers/stt/google-speech';
import { SttError } from '../../providers/stt/interface';
import { getSttProvider, resetSttProviderCache } from '../../providers/stt/index';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT = {
  client_email: 'svc@test-project.iam.gserviceaccount.com',
  private_key: privateKey,
  project_id: 'test-project',
};

const fetchMock = vi.fn();

function tokenOk(): Response {
  return new Response(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3599 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function recognizeOk(transcript: string): Response {
  return new Response(
    JSON.stringify({ results: [{ alternatives: [{ transcript, confidence: 0.95 }] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const AUDIO = new Uint8Array([1, 2, 3, 4]).buffer;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetSttProviderCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GoogleSpeechProvider.transcribe (Story V-1 AC4)', () => {
  it('sucesso — mint token → recognize → devolve a transcrição', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(recognizeOk('gastei 23 euros no almoço'));

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    const { text } = await provider.transcribe({
      audioBytes: AUDIO,
      mimeType: 'audio/ogg',
      languageCode: 'pt-PT',
    });

    expect(text).toBe('gastei 23 euros no almoço');
    // Chamada 1: token endpoint. Chamada 2: endpoint regional europe-west4.
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://oauth2.googleapis.com/token');
    const recognizeUrl = String(fetchMock.mock.calls[1]![0]);
    expect(recognizeUrl).toContain('europe-west4-speech.googleapis.com');
    expect(recognizeUrl).toContain('/projects/test-project/locations/europe-west4/recognizers/_:recognize');
    // Body pede pt-PT + autoDecodingConfig + chirp_2.
    const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(body.config.languageCodes).toEqual(['pt-PT']);
    expect(body.config.autoDecodingConfig).toEqual({});
    expect(body.config.model).toBe('chirp_2');
    expect(typeof body.content).toBe('string');
  });

  it('concatena múltiplos segmentos de results[]', async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            { alternatives: [{ transcript: 'olá' }] },
            { alternatives: [{ transcript: 'mundo' }] },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    const { text } = await provider.transcribe({
      audioBytes: AUDIO,
      mimeType: 'audio/ogg',
      languageCode: 'pt-PT',
    });
    expect(text).toBe('olá mundo');
  });

  it('resposta vazia (sem results) → text vazio (chamador trata como "não percebi")', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    const { text } = await provider.transcribe({
      audioBytes: AUDIO,
      mimeType: 'audio/ogg',
      languageCode: 'pt-PT',
    });
    expect(text).toBe('');
  });

  it('falha de rede no recognize → SttError (sem detalhes internos)', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockRejectedValueOnce(new Error('ECONNRESET'));

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    await expect(
      provider.transcribe({ audioBytes: AUDIO, mimeType: 'audio/ogg', languageCode: 'pt-PT' }),
    ).rejects.toBeInstanceOf(SttError);
  });

  it('quota (HTTP 429) no recognize → SttError, loga só o código', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(new Response('quota exceeded detail', { status: 429 }));

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    await expect(
      provider.transcribe({ audioBytes: AUDIO, mimeType: 'audio/ogg', languageCode: 'pt-PT' }),
    ).rejects.toBeInstanceOf(SttError);

    const logs = errorSpy.mock.calls.flat().map(String).join(' | ');
    expect(logs).toContain('429');
    expect(logs).not.toContain('quota exceeded detail');
  });

  it('token endpoint falha (HTTP 401) → SttError antes de chamar recognize', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const provider = new GoogleSpeechProvider({ serviceAccount: SERVICE_ACCOUNT });
    await expect(
      provider.transcribe({ audioBytes: AUDIO, mimeType: 'audio/ogg', languageCode: 'pt-PT' }),
    ).rejects.toBeInstanceOf(SttError);
    // Só a chamada ao token endpoint aconteceu (recognize não foi tentado).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getSttProvider — factory (Story V-1 AC4)', () => {
  it('lê a service account de STT_SERVICE_ACCOUNT_JSON (JSON em claro)', async () => {
    vi.stubEnv('STT_SERVICE_ACCOUNT_JSON', JSON.stringify(SERVICE_ACCOUNT));
    const provider = getSttProvider();
    expect(provider.id).toBe('google-speech-eu');
    // Singleton: segunda chamada devolve a mesma instância.
    expect(getSttProvider()).toBe(provider);
  });

  it('aceita a service account em base64', async () => {
    const b64 = Buffer.from(JSON.stringify(SERVICE_ACCOUNT)).toString('base64');
    vi.stubEnv('STT_SERVICE_ACCOUNT_JSON', b64);
    expect(getSttProvider().id).toBe('google-speech-eu');
  });

  it('lança SttError quando STT_SERVICE_ACCOUNT_JSON está ausente', async () => {
    vi.stubEnv('STT_SERVICE_ACCOUNT_JSON', '');
    expect(() => getSttProvider()).toThrow(SttError);
  });

  it('lança SttError quando o segredo não tem client_email/private_key', async () => {
    vi.stubEnv('STT_SERVICE_ACCOUNT_JSON', JSON.stringify({ foo: 'bar' }));
    expect(() => getSttProvider()).toThrow(SttError);
  });
});
