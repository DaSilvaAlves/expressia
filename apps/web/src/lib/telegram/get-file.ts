/**
 * Download de ficheiros da Telegram Bot API (Story V-1).
 *
 * Notas de voz chegam como `message.voice` com um `file_id` — o binário obtém-se
 * em duas chamadas HTTP encadeadas:
 *   1. `getFile(file_id)` → devolve `file_path` (e metadados).
 *   2. Download real via `https://api.telegram.org/file/bot<token>/<file_path>`.
 *
 * DECISÃO DE DEPENDÊNCIA — `fetch` nativo, sem pacote externo (mesmo padrão de
 * `client.ts`/`oauth.ts`, precedente J-1..J-8). Os dois endpoints são triviais
 * via `fetch`; um SDK do Telegram traria superfície não utilizada.
 *
 * Privacidade/segredo (mesma disciplina de `sendMessage`): em erro logamos SÓ o
 * código de estado HTTP — NUNCA o token nem o corpo da resposta (o binário é uma
 * nota de voz, dado íntimo). O áudio devolvido vive apenas em memória no chamador
 * (nunca persistido em disco/DB — NFR-V2).
 */

/** Erro tipado do download de ficheiro do Telegram (Story V-1 AC2). */
export class TelegramFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramFileError';
  }
}

/** Resultado do download: bytes em memória + mime type derivado da resposta. */
export interface DownloadedVoiceFile {
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
}

/** Shape mínima da resposta de `getFile` que consumimos. */
interface GetFileResponse {
  ok?: boolean;
  result?: { file_path?: string };
}

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramFileError('[telegram] TELEGRAM_BOT_TOKEN não definido');
  }
  return token;
}

/**
 * Faz download do binário de uma nota de voz a partir do seu `file_id`.
 *
 * Lança `TelegramFileError` (nunca um erro genérico) se: `getFile` responder
 * não-2xx ou sem `ok`, `file_path` vier ausente, ou o download do binário não
 * for 2xx. O chamador traduz numa mensagem amigável (degradação graciosa).
 *
 * @param fileId - `voice.file_id` do update.
 */
export async function downloadVoiceFile(
  fileId: string,
): Promise<DownloadedVoiceFile> {
  const token = getToken();

  // ─── 1. getFile → file_path ──────────────────────────────────────────────
  let getFileRes: Response;
  try {
    getFileRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );
  } catch {
    // Falha de transporte — nunca expomos o token/URL.
    throw new TelegramFileError('[telegram] getFile falhou no transporte');
  }

  if (!getFileRes.ok) {
    console.error(`[telegram] getFile falhou: ${getFileRes.status}`);
    throw new TelegramFileError(`[telegram] getFile falhou: ${getFileRes.status}`);
  }

  const json = (await getFileRes.json().catch(() => null)) as GetFileResponse | null;
  const filePath = json?.ok === true ? json.result?.file_path : undefined;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TelegramFileError('[telegram] getFile sem file_path na resposta');
  }

  // ─── 2. Download do binário ──────────────────────────────────────────────
  let downloadRes: Response;
  try {
    downloadRes = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
    );
  } catch {
    throw new TelegramFileError('[telegram] download do ficheiro falhou no transporte');
  }

  if (!downloadRes.ok) {
    console.error(`[telegram] download do ficheiro falhou: ${downloadRes.status}`);
    throw new TelegramFileError(
      `[telegram] download do ficheiro falhou: ${downloadRes.status}`,
    );
  }

  const bytes = await downloadRes.arrayBuffer();
  // Telegram serve notas de voz como OGG/Opus; usamos o Content-Type quando
  // presente e caímos em `audio/ogg` como default seguro.
  const mimeType = downloadRes.headers.get('content-type') ?? 'audio/ogg';

  return { bytes, mimeType };
}
