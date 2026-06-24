/**
 * Síntese do texto do brief diário (Story J-4).
 *
 * Recebe os dados agregados (tarefas + finanças) e devolve o texto PT-PT a
 * enviar no Telegram. Usa o provider OpenAI `gpt-4o-mini` (motor de produção
 * desde 24/06/2026) numa chamada de texto livre (sem tool calling).
 *
 * Resiliência (AC6): se o LLM falhar ou devolver vazio, recorre a um
 * `buildFallbackBrief` determinístico montado em código — o brief NUNCA fica
 * por enviar por causa do LLM.
 *
 * Privacidade (AC9): esta função recebe títulos de tarefas e valores. Os
 * callers NÃO devem logar o resultado nem os `BriefData` em claro.
 */
import { getProvider } from '@meu-jarvis/agent';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface BriefData {
  readonly tasksTodayCount: number;
  readonly tasksTodayTitles: readonly string[];
  readonly tasksOverdueCount: number;
  readonly tasksOverdueTitles: readonly string[];
  readonly financeIncomeCents: number;
  readonly financeExpenseCents: number;
  readonly financeBalanceCents: number;
  readonly accountsBalanceCents: number;
}

export interface SynthesizeResult {
  readonly text: string;
  readonly usedFallback: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatação PT-PT
// ─────────────────────────────────────────────────────────────────────────────

const EUR_FORMAT = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
});

/** Cêntimos de euro → string PT-PT (ex.: 888 → "8,88 €"). */
export function formatEur(cents: number): string {
  return EUR_FORMAT.format(cents / 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

const BRIEF_SYSTEM_PROMPT = `És o Jarvis, o assistente pessoal do Eurico. Escreves o brief da manhã: uma mensagem curta, calma e factual, em português europeu (PT-PT — NUNCA português do Brasil).

Regras:
- Começa com uma saudação breve de bom dia.
- Resume, por esta ordem: tarefas de hoje, tarefas atrasadas (se houver), e o estado das finanças do mês.
- Sê conciso: no máximo ~6 linhas. Não repitas listas longas — menciona o essencial.
- Usa apenas os dados fornecidos. NUNCA inventes tarefas, valores ou compromissos.
- Tom directo e útil, sem floreados. No máximo um emoji.
- Valores monetários no formato fornecido (euros com vírgula decimal).`;

function serializeBriefData(data: BriefData): string {
  const lines: string[] = [];
  lines.push(`Tarefas de hoje (${data.tasksTodayCount}):`);
  if (data.tasksTodayTitles.length > 0) {
    for (const t of data.tasksTodayTitles) lines.push(`- ${t}`);
  } else {
    lines.push('- (nenhuma)');
  }
  lines.push('');
  lines.push(`Tarefas atrasadas (${data.tasksOverdueCount}):`);
  if (data.tasksOverdueTitles.length > 0) {
    for (const t of data.tasksOverdueTitles) lines.push(`- ${t}`);
  } else {
    lines.push('- (nenhuma)');
  }
  lines.push('');
  lines.push('Finanças do mês:');
  lines.push(`- Receita: ${formatEur(data.financeIncomeCents)}`);
  lines.push(`- Despesa: ${formatEur(data.financeExpenseCents)}`);
  lines.push(`- Saldo do mês: ${formatEur(data.financeBalanceCents)}`);
  lines.push(`- Saldo total das contas: ${formatEur(data.accountsBalanceCents)}`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback determinístico (sem LLM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Brief montado em código — usado quando o LLM falha ou devolve vazio.
 * PT-PT, factual, sem dependência de rede.
 */
export function buildFallbackBrief(data: BriefData): string {
  const parts: string[] = ['Bom dia! Aqui está o teu resumo de hoje.'];

  if (data.tasksTodayCount === 0) {
    parts.push('Não tens tarefas marcadas para hoje.');
  } else if (data.tasksTodayCount === 1) {
    parts.push('Tens 1 tarefa para hoje.');
  } else {
    parts.push(`Tens ${data.tasksTodayCount} tarefas para hoje.`);
  }

  if (data.tasksOverdueCount === 1) {
    parts.push('Tens também 1 tarefa atrasada.');
  } else if (data.tasksOverdueCount > 1) {
    parts.push(`Tens também ${data.tasksOverdueCount} tarefas atrasadas.`);
  }

  parts.push(
    `Finanças do mês: receita ${formatEur(data.financeIncomeCents)}, ` +
      `despesa ${formatEur(data.financeExpenseCents)}, ` +
      `saldo ${formatEur(data.financeBalanceCents)}. ` +
      `Saldo total das contas: ${formatEur(data.accountsBalanceCents)}.`,
  );

  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Síntese via LLM (com fallback)
// ─────────────────────────────────────────────────────────────────────────────

export async function synthesizeBriefText(
  data: BriefData,
  opts: { traceId: string; householdId: string },
): Promise<SynthesizeResult> {
  try {
    const provider = getProvider({ preferredProvider: 'openai' });
    const result = await provider.complete({
      system: BRIEF_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: serializeBriefData(data) }],
      temperature: 0.6,
      maxTokens: 320,
      traceId: opts.traceId,
      householdId: opts.householdId,
    });

    const text = result.content?.trim();
    if (text === undefined || text.length === 0) {
      return { text: buildFallbackBrief(data), usedFallback: true };
    }
    return { text, usedFallback: false };
  } catch {
    // Qualquer falha do provider (rate limit, timeout, sem créditos, etc.) →
    // fallback determinístico. O brief NUNCA fica por enviar por causa do LLM.
    return { text: buildFallbackBrief(data), usedFallback: true };
  }
}
