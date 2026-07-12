// @vitest-environment node
/**
 * Testes de `downloadVoiceFile` — Story V-1 AC2.
 *
 * O cliente usa `fetch` nativo em 2 chamadas encadeadas (getFile → download).
 * O `fetch` é mockado globalmente; nunca há rede real. Cobrem-se o caminho feliz
 * e as 3 falhas tipadas (getFile não-2xx, file_path ausente, download não-2xx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadVoiceFile, TelegramFileError } from '@/lib/telegram/get-file';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '12345:fake-bot-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function getFileOk(filePath: string): Response {
  return new Response(JSON.stringify({ ok: true, result: { file_path: filePath } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('downloadVoiceFile (Story V-1 AC2)', () => {
  it('caminho feliz — getFile → download devolve bytes + mimeType', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    fetchMock
      .mockResolvedValueOnce(getFileOk('voice/file_1.oga'))
      .mockResolvedValueOnce(
        new Response(audio, { status: 200, headers: { 'content-type': 'audio/ogg' } }),
      );

    const result = await downloadVoiceFile('abc123');

    expect(new Uint8Array(result.bytes)).toEqual(audio);
    expect(result.mimeType).toBe('audio/ogg');
    // Chamada 1: getFile com o file_id; chamada 2: endpoint de ficheiros.
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/getFile?file_id=abc123');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/file/bot');
    expect(String(fetchMock.mock.calls[1]![0])).toContain('voice/file_1.oga');
  });

  it('falha 1 — getFile responde não-2xx → TelegramFileError', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    await expect(downloadVoiceFile('abc123')).rejects.toBeInstanceOf(TelegramFileError);
  });

  it('falha 2 — file_path ausente na resposta → TelegramFileError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(downloadVoiceFile('abc123')).rejects.toBeInstanceOf(TelegramFileError);
  });

  it('falha 3 — download do binário não-2xx → TelegramFileError', async () => {
    fetchMock
      .mockResolvedValueOnce(getFileOk('voice/file_1.oga'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(downloadVoiceFile('abc123')).rejects.toBeInstanceOf(TelegramFileError);
  });

  it('nunca loga o token nem o corpo em erro (só o código de estado)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response('segredo-do-corpo', { status: 500 }));

    await expect(downloadVoiceFile('abc123')).rejects.toBeInstanceOf(TelegramFileError);

    const logs = errorSpy.mock.calls.flat().map(String).join(' | ');
    expect(logs).not.toContain('fake-bot-token');
    expect(logs).not.toContain('segredo-do-corpo');
    expect(logs).toContain('500');
  });
});
