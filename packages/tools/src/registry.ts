/**
 * `ToolRegistry` — registo central de tools do Cérebro AI.
 *
 * Trace: Story 2.3 AC3 + Architecture §4.3 (`toolRegistry` como single source
 *        of truth) + NFR11 (`get()` O(1) lookup).
 *
 * Responsabilidades:
 *   - Registar tools concretas (Stories 2.6/2.7/2.8) idempotentemente.
 *   - Lookup O(1) por nome para o Planner+Executor (Story 2.5).
 *   - Filtro por domínio para o Classifier (Story 2.4 — só passa tools do
 *     domain detectado ao Planner).
 *   - Conversão para o formato Anthropic SDK `tools[]` via `zod-to-json-schema`.
 *
 * Padrão singleton: o package exporta uma instância única `toolRegistry`.
 * As tools concretas registam-se em side-effect imports (Story 2.6+) ou via
 * orquestrador no startup (consideração de Story 2.5 — não fixada agora).
 */
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { ToolDefinition, ToolDomain } from '@/contracts';
import { DuplicateToolError, ToolNotFoundError } from '@/errors';

/**
 * Forma de uma tool definition serializada para o Anthropic SDK
 * `client.messages.create({ tools: [...] })`.
 *
 * Match com `MinimalToolDefinitionSchema` em `@meu-jarvis/agent` — Story 2.5
 * substitui o uso de `MinimalToolDefinition` por chamada a
 * `toolRegistry.getAnthropicToolDefinitions()`.
 */
export interface AnthropicToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/**
 * Registo de tools com lookup O(1) por nome.
 *
 * **Idempotência por referência:** chamar `register(toolA)` duas vezes com a
 * MESMA referência de objecto NÃO lança erro (segundo register é no-op).
 * Apenas lança `DuplicateToolError` quando o `name` colide com uma tool
 * diferente já registada.
 *
 * Razão: stories podem importar e registar as mesmas tools por caminhos
 * diferentes (ex: barrel re-export); idempotência protege contra crashes
 * espúrios de startup.
 */
export class ToolRegistry {
  // Map interno garante O(1) get/has/set.
  // Tipos `unknown, unknown` no valor permitem armazenar qualquer ToolDefinition
  // sem variance issues (callers fazem cast explícito quando necessário).
  readonly #tools = new Map<string, ToolDefinition<unknown, unknown>>();

  /**
   * Regista uma tool. Idempotente quando chamado com a mesma referência.
   *
   * @param tool - Tool a registar.
   * @throws {DuplicateToolError} Se outra tool DIFERENTE com o mesmo `name`
   *   já está registada.
   */
  register<I, O>(tool: ToolDefinition<I, O>): void {
    const existing = this.#tools.get(tool.name);
    if (existing !== undefined) {
      // Idempotência por referência: mesma tool registada duas vezes não falha.
      if (existing === (tool as unknown as ToolDefinition<unknown, unknown>)) {
        return;
      }
      // Colisão de nome com tool diferente — erro de configuração.
      throw new DuplicateToolError(tool.name, tool.domain);
    }
    this.#tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }

  /**
   * Retorna a tool registada com este nome.
   *
   * @param name - Nome da tool (ex: 'criar_tarefa').
   * @throws {ToolNotFoundError} Se nenhuma tool com este nome está registada.
   * @returns A tool definition (tipos genéricos como `unknown` — caller
   *   é responsável por validar input via `inputSchema`).
   */
  get(name: string): ToolDefinition<unknown, unknown> {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new ToolNotFoundError(name);
    }
    return tool;
  }

  /**
   * Indica se uma tool com este nome está registada (não lança erro).
   */
  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /**
   * Retorna todas as tools registadas, na ordem de registo (Map preserva
   * insertion order).
   */
  list(): ToolDefinition<unknown, unknown>[] {
    return Array.from(this.#tools.values());
  }

  /**
   * Filtra tools pelo domínio funcional.
   *
   * Usado pelo Classifier (Story 2.4) para passar ao Planner apenas as
   * tools relevantes para a intent detectada — reduz tokens e ambiguidade.
   *
   * @param domain - Domínio funcional.
   * @returns Tools registadas com `tool.domain === domain`.
   */
  getByDomain(domain: ToolDomain): ToolDefinition<unknown, unknown>[] {
    return this.list().filter((t) => t.domain === domain);
  }

  /**
   * Serializa todas as tools registadas para o formato aceite pelo
   * Anthropic SDK `client.messages.create({ tools: [...] })`.
   *
   * O `inputSchema` Zod de cada tool é convertido para JSON Schema 7 via
   * `zod-to-json-schema`. O output é estável e deterministicamente derivável
   * dos schemas — pode ser cacheado por chamada à custa de invalidação no
   * `register()`/`clear()` (não implementado nesta story; Story 2.5 pode
   * adicionar cache se necessário para latência).
   *
   * @returns Array no formato esperado pelo SDK Anthropic.
   *
   * @example
   *   const result = await client.messages.create({
   *     model: 'claude-sonnet-4-5',
   *     tools: toolRegistry.getAnthropicToolDefinitions(),
   *     // ...
   *   });
   */
  getAnthropicToolDefinitions(): AnthropicToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.inputSchema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    }));
  }

  /**
   * Esvazia o registry. **APENAS para testes.**
   *
   * Em produção isto causa estado inconsistente — tools registadas em
   * side-effect imports não voltam a ser registadas sem reload.
   *
   * @internal Apenas para testes — não usar em produção.
   */
  clear(): void {
    this.#tools.clear();
  }
}

/**
 * Instância singleton exportada — toda a aplicação partilha o mesmo registo
 * de tools.
 *
 * Stories 2.6 (Tarefas), 2.7 (Finanças), 2.8 (Consultas) registam as suas
 * tools concretas neste singleton no carregamento do módulo.
 */
export const toolRegistry: ToolRegistry = new ToolRegistry();
