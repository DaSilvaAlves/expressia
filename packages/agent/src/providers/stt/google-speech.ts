/**
 * GoogleSpeechProvider — adaptador Google Cloud Speech-to-Text **v2**, região
 * `europe-west4` (Story V-1 AC4).
 *
 * DECISÃO DE FORNECEDOR (Story V-1 Tarefa 0, validada pelo Eurico): Google Cloud
 * Speech-to-Text v2, `europe-west4`. Residência de dados na UE garantida
 * (constraint inegociável do CLAUDE.md) e `OGG_OPUS` (formato nativo das notas de
 * voz do Telegram) aceite por auto-decoding — sem transcodificação em runtime.
 *
 * DECISÃO DE DEPENDÊNCIA (`fetch` nativo + `node:crypto`, sem SDK) — mesmo padrão
 * estabelecido em J-3/J-5..J-8 (`google/oauth.ts`), que rejeitou explicitamente o
 * `googleapis`/SDK oficial por trazer superfície não utilizada. O SDK oficial
 * `@google-cloud/speech` assenta em gRPC (pesado e problemático em serverless
 * Vercel). Aqui bastam 2 chamadas HTTP: mint do access token via JWT-bearer
 * (assinado RS256 com `node:crypto`) e o `recognize` regional. Auth por
 * service-account (distinta do OAuth de utilizador do Calendar/Gmail).
 *
 * API confirmada contra a documentação oficial (Article IV — sem invenção):
 *   - POST https://europe-west4-speech.googleapis.com/v2/projects/{P}/locations/
 *     europe-west4/recognizers/_:recognize  (recognizer implícito `_` + config inline)
 *   - body: { config: { autoDecodingConfig: {}, languageCodes: ['pt-PT'],
 *     model: 'chirp_2' }, content: <base64> }
 *   - resposta: results[].alternatives[0].transcript
 *   - JWT-bearer: scope cloud-platform, aud oauth2.googleapis.com/token, RS256.
 *
 * LIMITE TÉCNICO (documentado): o `recognize` síncrono inline aceita no máximo
 * ~60 s / ~10 MB de áudio. A guarda de duração da story (AC3) é 120 s (escolha de
 * produto) — uma nota entre 60 s e 120 s passa a guarda mas a STT devolve erro,
 * apanhado como degradação graciosa. Ver Completion Notes da story (ajuste do cap
 * fica para o E2E do Eurico, AC11d).
 *
 * Privacidade (NFR-V1/V2): nunca logamos a chave privada, o access token nem a
 * transcrição em claro — só o código de estado HTTP em erro.
 */
import crypto from 'node:crypto';

import { SttError, type SttProviderInterface } from './interface';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_REGION = 'europe-west4';
/** `chirp_2` é o modelo confirmado para `pt-PT` em `europe-west4` (GA). */
const DEFAULT_MODEL = 'chirp_2';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Chave da service-account (subconjunto usado do JSON key do GCP). */
export interface ServiceAccountKey {
  readonly client_email: string;
  readonly private_key: string;
  readonly project_id?: string;
}

export interface GoogleSpeechProviderOpts {
  readonly serviceAccount: ServiceAccountKey;
  /** Override do projecto GCP. Default: `serviceAccount.project_id`. */
  readonly project?: string;
  /** Override da região. Default: `europe-west4`. */
  readonly region?: string;
  /** Override do modelo. Default: `chirp_2`. */
  readonly model?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class GoogleSpeechProvider implements SttProviderInterface {
  public readonly id = 'google-speech-eu';
  private readonly serviceAccount: ServiceAccountKey;
  private readonly project: string;
  private readonly region: string;
  private readonly model: string;

  constructor(opts: GoogleSpeechProviderOpts) {
    this.serviceAccount = opts.serviceAccount;
    const project = opts.project ?? opts.serviceAccount.project_id;
    if (!project) {
      throw new SttError('Projecto GCP em falta (nem opts.project nem project_id na service account).');
    }
    this.project = project;
    this.region = opts.region ?? DEFAULT_REGION;
    this.model = opts.model ?? DEFAULT_MODEL;
  }

  async transcribe(input: {
    audioBytes: ArrayBuffer;
    mimeType: string;
    languageCode: 'pt-PT';
  }): Promise<{ text: string }> {
    const accessToken = await this.mintAccessToken();
    const base64Audio = Buffer.from(input.audioBytes).toString('base64');

    const url = `https://${this.region}-speech.googleapis.com/v2/projects/${this.project}/locations/${this.region}/recognizers/_:recognize`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            // `autoDecodingConfig` deteta contentor+codec do cabeçalho do
            // ficheiro — cobre OGG_OPUS (Telegram) sem transcodificação.
            autoDecodingConfig: {},
            languageCodes: [input.languageCode],
            model: this.model,
          },
          content: base64Audio,
        }),
      });
    } catch {
      // Falha de transporte (rede/DNS). Nunca expomos o token nem o áudio.
      throw new SttError('Falha de rede ao contactar o serviço de transcrição.');
    }

    if (!res.ok) {
      // Cobre quota (429), auth (403), indisponibilidade (5xx). Só o código.
      console.error(`[stt] recognize falhou: ${res.status}`);
      throw new SttError(`Serviço de transcrição respondeu ${res.status}.`);
    }

    const json = (await res.json().catch(() => null)) as unknown;
    if (!isRecord(json)) {
      throw new SttError('Resposta do serviço de transcrição ilegível.');
    }

    return { text: extractTranscript(json) };
  }

  /**
   * Mint de um access token Google via fluxo JWT-bearer da service-account.
   * O JWT é assinado RS256 com a chave privada da SA (`node:crypto`). O token e a
   * chave nunca são logados.
   */
  private async mintAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.serviceAccount.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: GOOGLE_TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600, // máximo permitido: iat + 1h.
    };
    const b64url = (obj: unknown): string =>
      Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64url(header)}.${b64url(claims)}`;

    let signature: string;
    try {
      signature = crypto
        .sign('RSA-SHA256', Buffer.from(unsigned), this.serviceAccount.private_key)
        .toString('base64url');
    } catch {
      // Chave privada malformada — falha de configuração, não expomos detalhes.
      throw new SttError('Falha ao assinar as credenciais do serviço de transcrição.');
    }
    const jwt = `${unsigned}.${signature}`;

    let res: Response;
    try {
      res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }).toString(),
      });
    } catch {
      throw new SttError('Falha de rede ao autenticar no serviço de transcrição.');
    }

    if (!res.ok) {
      console.error(`[stt] token endpoint falhou: ${res.status}`);
      throw new SttError(`Autenticação no serviço de transcrição falhou (${res.status}).`);
    }

    const json = (await res.json().catch(() => null)) as unknown;
    const accessToken =
      isRecord(json) && typeof json.access_token === 'string' ? json.access_token : null;
    if (!accessToken) {
      throw new SttError('Resposta de autenticação do serviço de transcrição sem access token.');
    }
    return accessToken;
  }
}

/**
 * Extrai e concatena a transcrição de uma `RecognizeResponse` v2. Cada entrada de
 * `results[]` é um segmento; `alternatives[0]` é a hipótese de topo. Resposta sem
 * resultados → string vazia (o chamador trata como "não percebi nada", não erro).
 */
function extractTranscript(response: Record<string, unknown>): string {
  const results = response.results;
  if (!Array.isArray(results)) {
    return '';
  }
  const parts: string[] = [];
  for (const result of results) {
    if (!isRecord(result)) continue;
    const alternatives = result.alternatives;
    if (!Array.isArray(alternatives) || alternatives.length === 0) continue;
    const top = alternatives[0];
    if (isRecord(top) && typeof top.transcript === 'string') {
      parts.push(top.transcript);
    }
  }
  return parts.join(' ').trim();
}
