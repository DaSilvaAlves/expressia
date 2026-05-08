/**
 * Interface tipada de um provider LLM — comum a Anthropic + OpenAI.
 *
 * Trace: Story 2.2 AC2.
 *
 * Princípio: provider-agnostic. Stories 2.4+ (Classifier, Planner+Executor)
 * consomem `ProviderInterface` sem conhecer a implementação subjacente.
 */
import type {
  LlmModel,
  ProviderCompleteInput,
  ProviderCompleteOutput,
} from '../contracts';
import type { ProviderId } from '../errors';

export interface ProviderInterface {
  /** Identifica o provider — match com `ProviderId` em errors.ts. */
  readonly id: ProviderId;
  /** Modelo configurado para esta instância. */
  readonly model: LlmModel;
  /**
   * Completa uma chamada ao LLM.
   *
   * Lança `ProviderError` em qualquer falha (mapeada de SDK errors).
   * Retorna `ProviderCompleteOutput` validado por Zod.
   */
  complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput>;
}
