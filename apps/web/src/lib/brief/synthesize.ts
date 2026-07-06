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

import type { CalendarEvent } from '@/lib/google/calendar';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estado da agenda (Google Calendar) no brief — tipo discriminado para
 * distinguir três casos com tratamento diferente (decisão de design crítica
 * para não poluir o brief com notas de agenda antes de o OAuth estar ligado):
 *
 *   - `connected`   — token OAuth presente e leitura OK; `events` pode ser `[]`
 *                     (sem compromissos hoje → linha "Sem eventos no calendário
 *                     hoje").
 *   - `unavailable` — token presente mas o refresh ou a leitura falharam →
 *                     nota discreta ao utilizador ("não foi possível ler hoje").
 *   - `not_connected` — sem token OAuth (caso normal até J-3 entrar em prod) →
 *                     OMITIR a secção da agenda por completo, SEM nota.
 */
export type CalendarSection =
  | { readonly status: 'connected'; readonly events: readonly CalendarEvent[] }
  | { readonly status: 'unavailable' }
  | { readonly status: 'not_connected' };

export interface BriefData {
  readonly calendar: CalendarSection;
  readonly tasksTodayCount: number;
  readonly tasksTodayTitles: readonly string[];
  readonly tasksOverdueCount: number;
  readonly tasksOverdueTitles: readonly string[];
  readonly financeIncomeCents: number;
  readonly financeExpenseCents: number;
  readonly financeBalanceCents: number;
  readonly accountsBalanceCents: number;
  /**
   * Resumo dos emails não lidos do inbox (Story J-6). Opcional e gracioso:
   * `undefined`/`[]` → secção de email omitida por completo do brief (sem nota).
   * Preenchido por `resolveEmailSection` em `build-brief.ts`. Nunca persistido.
   */
  readonly emailSummary?: readonly {
    readonly subject: string;
    readonly from: string;
    readonly receivedAt: string;
    readonly snippet: string;
  }[];
  /**
   * Memórias explícitas do Eurico (guardadas via "lembra-te que…", Story M-1),
   * a ter em conta ao comentar as restantes secções do brief (Story M-3).
   * Opcional e gracioso: `undefined`/`[]` → secção `[O que sabes sobre o Eurico]`
   * omitida por completo (regressão zero para households sem memórias). Preenchido
   * por `resolveMemoriesSection` em `build-brief.ts`. NUNCA usado no
   * `buildFallbackBrief` (template determinístico não interpreta preferências).
   */
  readonly memories?: readonly string[];
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

/** Fuso horário do mercado PT-PT (CON — Portugal continental). */
const TZ = 'Europe/Lisbon';

const TIME_FORMAT = new Intl.DateTimeFormat('pt-PT', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Hora local (Europe/Lisbon) de um evento, formato 24h PT-PT ("HH:MM"). */
function formatEventTime(start: Date): string {
  return TIME_FORMAT.format(start);
}

/**
 * Detecta eventos all-day: a Google Calendar API entrega-os como `date`
 * (sem hora), que `calendar.ts` converte para a meia-noite wall-clock de Lisbon.
 * Heurística: começa exactamente às 00:00 em Lisbon. Suficiente para a copy do
 * brief (distinguir "(todo o dia)" de uma hora concreta).
 */
function isAllDayEvent(start: Date): boolean {
  const parts = TIME_FORMAT.formatToParts(start);
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  return hour === '00' && minute === '00';
}

/** Linha PT-PT de um evento: "09:30 Reunião" ou "(todo o dia) Aniversário". */
function formatEventLine(event: CalendarEvent): string {
  const prefix = isAllDayEvent(event.start) ? '(todo o dia)' : formatEventTime(event.start);
  return `${prefix} ${event.summary}`;
}

/**
 * Constrói as linhas da secção de agenda partilhadas por `serializeBriefData` e
 * `buildFallbackBrief`. Devolve `[]` para `not_connected` (secção omitida).
 */
function calendarLines(calendar: CalendarSection): string[] {
  switch (calendar.status) {
    case 'not_connected':
      return [];
    case 'unavailable':
      return ['Agenda: não foi possível ler hoje.'];
    case 'connected': {
      if (calendar.events.length === 0) {
        return ['Sem eventos no calendário hoje.'];
      }
      const lines = ['Agenda de hoje:'];
      for (const event of calendar.events) {
        lines.push(`- ${formatEventLine(event)}`);
      }
      return lines;
    }
  }
}

/**
 * Constrói as linhas da secção de email (emails não lidos do inbox), partilhadas
 * por `serializeBriefData` e `buildFallbackBrief`. Devolve `[]` quando não há
 * `emailSummary` ou está vazio (secção omitida por completo — degradação
 * graciosa, padrão da agenda). Story J-6 AC11.
 */
function emailLines(emailSummary: BriefData['emailSummary']): string[] {
  if (emailSummary === undefined || emailSummary.length === 0) {
    return [];
  }
  const lines = [`Emails não lidos (${emailSummary.length}):`];
  for (const email of emailSummary) {
    // Snippet truncado para manter o prompt enxuto — o LLM resume na mesma.
    const snippet = email.snippet.length > 120 ? `${email.snippet.slice(0, 120)}…` : email.snippet;
    lines.push(`- ${email.from}: ${email.subject} — ${snippet}`);
  }
  return lines;
}

/**
 * Constrói as linhas da secção de memória (`[O que sabes sobre o Eurico]`),
 * injectada SÓ no prompt de síntese LLM (`serializeBriefData`) — NUNCA no
 * `buildFallbackBrief` (Story M-3, decisão de âmbito). Devolve `[]` quando não há
 * `memories` ou está vazio (secção omitida por completo — regressão zero para
 * households sem memórias). Bloco listado ANTES da agenda para que o LLM tenha as
 * preferências em conta ao comentar qualquer secção seguinte.
 */
function memoryLines(memories: BriefData['memories']): string[] {
  if (memories === undefined || memories.length === 0) {
    return [];
  }
  const lines = ['[O que sabes sobre o Eurico]'];
  for (const memory of memories) {
    lines.push(`- ${memory}`);
  }
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt
// ─────────────────────────────────────────────────────────────────────────────

const BRIEF_SYSTEM_PROMPT = `És o Jarvis, o assistente pessoal do Eurico. Escreves o brief da manhã: uma mensagem curta, calma e factual, em português europeu (PT-PT — NUNCA português do Brasil).

Regras:
- Começa com uma saudação breve de bom dia.
- Resume, por esta ordem: agenda de hoje, tarefas de hoje, tarefas atrasadas (se houver), o estado das finanças do mês e, por fim, os emails não lidos.
- Se for fornecida a secção \`[O que sabes sobre o Eurico]\`, tem essas preferências em conta ao comentar as secções seguintes (agenda/tarefas/finanças/emails) — ex.: ajusta o tom sobre um compromisso que colida com uma preferência conhecida. NÃO repitas a lista de preferências literalmente no brief, a menos que seja directamente relevante para o comentário de uma secção concreta. Se a secção não constar nos dados, não menciones preferência alguma.
- Se a secção da agenda não constar nos dados, não menciones a agenda de todo.
- Se for fornecida a secção \`Emails não lidos\`, inclui um resumo breve dos emails por responder (máx. 2-3 frases; ex.: "Tens 2 emails por responder — um do Pedro sobre a reunião e outro do banco."). Omite completamente a secção se não constar nos dados.
- Trata o Eurico sempre por "tu" e usa formas verbais informais. Exemplos correctos: "Tens 3 tarefas.", "Tem um bom dia." — NUNCA "Tenha um bom dia." (formal) nem "Você tem".
- Sê conciso: no máximo ~6 linhas. Não repitas listas longas — menciona o essencial.
- Usa apenas os dados fornecidos. NUNCA inventes eventos, tarefas, valores, emails ou compromissos.
- Tom directo e útil, sem floreados. No máximo um emoji.
- Valores monetários no formato fornecido (euros com vírgula decimal).`;

function serializeBriefData(data: BriefData): string {
  const lines: string[] = [];

  // Memória primeiro (Story M-3): as preferências do Eurico precedem TUDO para
  // que o LLM as tenha em conta ao comentar qualquer secção seguinte. Omitida por
  // completo quando não há memórias (regressão zero).
  const memories = memoryLines(data.memories);
  if (memories.length > 0) {
    lines.push(...memories);
    lines.push('');
  }

  // Agenda depois (ordem do PRD: agenda → tarefas → finanças). Omitida por
  // completo quando `not_connected` (sem token OAuth).
  const calendar = calendarLines(data.calendar);
  if (calendar.length > 0) {
    lines.push(...calendar);
    lines.push('');
  }

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

  // Email no fim (ordem PRD: agenda → tarefas → finanças → email). Omitido por
  // completo quando não há emails não lidos (degradação graciosa).
  const emails = emailLines(data.emailSummary);
  if (emails.length > 0) {
    lines.push('');
    lines.push(...emails);
  }

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

  // Agenda primeiro (omitida quando `not_connected`).
  const calendar = calendarLines(data.calendar);
  if (calendar.length > 0) {
    parts.push(calendar.join('\n'));
  }

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

  // Email por último (omitido quando não há emails não lidos).
  const emailCount = data.emailSummary?.length ?? 0;
  if (emailCount === 1) {
    parts.push('Tens 1 email não lido por rever.');
  } else if (emailCount > 1) {
    parts.push(`Tens ${emailCount} emails não lidos por rever.`);
  }

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
