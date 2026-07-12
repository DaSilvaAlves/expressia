/**
 * Interface tipada de um provider de Speech-to-Text (STT) — Story V-1 AC4.
 *
 * Espelha o padrão provider-agnostic de `ProviderInterface` (providers de texto
 * Anthropic/OpenAI): o webhook do Telegram consome `SttProviderInterface` sem
 * conhecer o provider concreto. A escolha final do fornecedor (Google Cloud
 * Speech-to-Text v2, `europe-west4` — decisão validada, ver Dev Notes da story)
 * fica isolada na implementação; trocar de fornecedor não obriga a mexer no
 * webhook, só no adaptador concreto.
 */
export interface SttProviderInterface {
  /** Identifica o provider — ex.: `'google-speech-eu'`. */
  readonly id: string;
  /**
   * Transcreve um áudio para texto.
   *
   * `languageCode` fixo em `'pt-PT'` (PT-PT europeu — NFR-J8 por extensão).
   * Lança `SttError` (nunca detalhes internos do SDK/API) em qualquer falha.
   */
  transcribe(input: {
    audioBytes: ArrayBuffer;
    mimeType: string;
    languageCode: 'pt-PT';
  }): Promise<{ text: string }>;
}

/**
 * Erro tipado do domínio STT (Story V-1 AC4). Encapsula qualquer falha do
 * provider (rede, quota, resposta vazia, credencial) sem propagar detalhes
 * internos do SDK/API ao utilizador final.
 */
export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SttError';
  }
}
