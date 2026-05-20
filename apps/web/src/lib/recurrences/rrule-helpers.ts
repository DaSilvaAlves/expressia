/**
 * Helpers de expansão de recorrências — timezone-aware DST-safe (Europe/Lisbon).
 *
 * Story 3.7 AC3 — função pura `expandRecurrence` que recebe a definição de uma
 * `task_recurrences` e devolve as ocorrências futuras dentro de um horizonte
 * (90 dias por D-3.7.1). Não depende de Inngest nem de Drizzle — testável em
 * isolamento total (zero mocks, zero rede).
 *
 * Mitigação R-3.7.2 (DST Portugal):
 *   As ocorrências são computadas pela `rrule` (iCal RFC 5545) que devolve
 *   `Date[]` em UTC. A conversão para a data de calendário visível ao
 *   utilizador (`YYYY-MM-DD`) é feita SEMPRE via `formatInTimeZone(date,
 *   'Europe/Lisbon', 'yyyy-MM-dd')` — nunca `date.toISOString().slice(0,10)`.
 *   Em transições DST (último domingo de Março/Outubro) o offset WET/WEST
 *   muda; usar UTC directo skiparia ou duplicaria dias. O `DTSTART` é fixado
 *   ao meio-dia (12:00) para evitar a janela ambígua 02:00→03:00.
 *
 * Trace: EPIC-3-EXECUTION.yaml §stories[3.7] linha 390, Architecture §11.3,
 *        D-3.7.1 (horizon 90d), D-3.7.5 (date-fns-tz formatInTimeZone).
 */
import { addDays, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { RRule, RRuleSet, rrulestr } from 'rrule';

/** Fuso horário do mercado PT-PT (CON — Portugal continental). */
export const TZ = 'Europe/Lisbon';

/** Horizonte de geração por defeito — 90 dias (EPIC DP6 / D-3.7.1). */
export const EXPAND_HORIZON_DAYS = 90 as const;

/**
 * Frequências suportadas pela `task_recurrences` (FR8). Espelho do
 * `recurrenceFrequencyEnum` em `packages/db/src/schema/tasks.ts`.
 */
export type RecurrenceFrequency =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

/** Definição mínima de recorrência necessária para expandir ocorrências. */
export interface RecurrenceInput {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  readonly customRrule: string | null;
  /** `YYYY-MM-DD`. */
  readonly startsOn: string;
  /** `YYYY-MM-DD` ou `null`. */
  readonly endsOn: string | null;
  /** `YYYY-MM-DD` ou `null` — não usado no cálculo (cron já filtrou). */
  readonly nextRunOn: string | null;
}

/** Opções de expansão — `now` é injectável para tests determinísticos. */
export interface ExpandOptions {
  readonly horizonDays: number;
  readonly now: Date;
}

/** Resultado da expansão de uma recorrência. */
export interface ExpandResult {
  /** Ocorrências dentro do horizonte, ordenadas ascendente. `targetDate` em `YYYY-MM-DD`. */
  readonly occurrences: ReadonlyArray<{ targetDate: string }>;
  /** Primeira ocorrência DEPOIS do horizonte, ou `null` se a RRULE esgotou. */
  readonly nextRunAfterHorizon: string | null;
  /** `true` se `endsOn` já passou ou a RRULE não tem mais ocorrências. */
  readonly isExhausted: boolean;
}

/**
 * Constrói a string RRULE iCal (RFC 5545) a partir da `frequency` + `interval`.
 *
 * Exportada para reuso directo em testes. O componente `RRULE:` é incluído
 * para compatibilidade com `rrulestr`.
 */
export function frequencyToRRuleString(
  frequency: RecurrenceFrequency,
  interval: number,
  customRrule: string | null,
): string {
  const safeInterval = Number.isFinite(interval) && interval >= 1 ? Math.trunc(interval) : 1;

  switch (frequency) {
    case 'daily':
      return `RRULE:FREQ=DAILY;INTERVAL=${safeInterval}`;
    case 'weekly':
      return `RRULE:FREQ=WEEKLY;INTERVAL=${safeInterval}`;
    case 'biweekly':
      // Biweekly ignora `interval` — é sempre de 2 em 2 semanas.
      return 'RRULE:FREQ=WEEKLY;INTERVAL=2';
    case 'monthly':
      return `RRULE:FREQ=MONTHLY;INTERVAL=${safeInterval}`;
    case 'yearly':
      return `RRULE:FREQ=YEARLY;INTERVAL=${safeInterval}`;
    case 'weekdays':
      return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekends':
      return 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU';
    case 'custom': {
      if (customRrule === null || customRrule.trim() === '') {
        throw new Error(
          'expandRecurrence: frequency=custom requer customRrule não-vazio (RFC 5545).',
        );
      }
      // A string custom pode ou não trazer o prefixo `RRULE:` — normalizar.
      const trimmed = customRrule.trim();
      return /^RRULE:/i.test(trimmed) ? trimmed : `RRULE:${trimmed}`;
    }
    default: {
      // Exhaustividade — TypeScript garante que todos os casos são tratados.
      const exhaustive: never = frequency;
      throw new Error(`expandRecurrence: frequency desconhecida: ${String(exhaustive)}`);
    }
  }
}

/**
 * Converte uma data de calendário `YYYY-MM-DD` (interpretada em Europe/Lisbon
 * ao meio-dia) para um `Date` UTC. O meio-dia evita a janela ambígua DST.
 */
function zonedNoonToUtc(isoDate: string): Date {
  return fromZonedTime(`${isoDate}T12:00:00`, TZ);
}

/**
 * Expande uma recorrência nas suas ocorrências futuras dentro do horizonte.
 *
 * Pura e determinística — dado o mesmo `recurrence` + `options`, devolve sempre
 * o mesmo resultado. `options.now` permite testes sem `vi.setSystemTime`.
 *
 * @example
 *   expandRecurrence(
 *     { frequency: 'daily', interval: 1, customRrule: null,
 *       startsOn: '2026-01-01', endsOn: null, nextRunOn: null },
 *     { horizonDays: 90, now: new Date('2026-05-20T00:00:00Z') },
 *   );
 */
export function expandRecurrence(
  recurrence: RecurrenceInput,
  options: ExpandOptions,
): ExpandResult {
  const { horizonDays, now } = options;

  // `endsOn` no passado → recorrência esgotada, zero ocorrências.
  if (recurrence.endsOn !== null) {
    const endsOnUtc = zonedNoonToUtc(recurrence.endsOn);
    if (endsOnUtc.getTime() < now.getTime()) {
      return { occurrences: [], nextRunAfterHorizon: null, isExhausted: true };
    }
  }

  // Construir a regra RRULE com DTSTART = startsOn ao meio-dia Lisboa.
  const ruleString = frequencyToRRuleString(
    recurrence.frequency,
    recurrence.interval,
    recurrence.customRrule,
  );
  const dtstart = zonedNoonToUtc(recurrence.startsOn);
  const until =
    recurrence.endsOn !== null
      ? // `until` ao fim do dia em Lisboa para incluir a própria data `endsOn`.
        zonedNoonToUtc(recurrence.endsOn)
      : undefined;

  const parsed = rrulestr(ruleString, {
    dtstart,
    ...(until !== undefined ? { forceset: false } : {}),
  });

  // `rrulestr` pode devolver `RRule` ou `RRuleSet`; normalizar para algo com
  // `.between()` e `.after()`. Se houver `until`, reconstruímos a `RRule` com
  // a opção `until` aplicada (rrulestr não injecta `until` via options).
  const rule: RRule | RRuleSet =
    parsed instanceof RRuleSet
      ? parsed
      : new RRule({ ...parsed.origOptions, dtstart, ...(until !== undefined ? { until } : {}) });

  // Janela [now, now + horizonDays] inclusive. O fim do horizonte é levado ao
  // fim do dia (23:59:59.999 UTC) para garantir que a ocorrência do último dia
  // — fixada ao meio-dia Lisboa — cai dentro da janela `between`.
  const horizonEnd = new Date(addDays(now, horizonDays).getTime() + (86_400_000 - 1));
  const occurrenceDates = rule.between(now, horizonEnd, true);

  // Converter cada Date UTC para a data de calendário visível (Europe/Lisbon).
  const seen = new Set<string>();
  const occurrences: Array<{ targetDate: string }> = [];
  for (const d of occurrenceDates) {
    const targetDate = formatInTimeZone(d, TZ, 'yyyy-MM-dd');
    // Deduplicar — em DST fall-back duas instâncias UTC podem mapear no mesmo dia.
    if (!seen.has(targetDate)) {
      seen.add(targetDate);
      occurrences.push({ targetDate });
    }
  }

  // Próxima ocorrência DEPOIS do fim do horizonte — usada para `next_run_on`.
  // `after(horizonEnd, false)` exclui a fronteira: a primeira ocorrência
  // estritamente posterior ao último instante do horizonte.
  const afterHorizon = rule.after(horizonEnd, false);
  const nextRunAfterHorizon =
    afterHorizon !== null ? formatInTimeZone(afterHorizon, TZ, 'yyyy-MM-dd') : null;

  // Esgotada quando a RRULE não tem mais ocorrências para lá do horizonte
  // (ex.: `endsOn` já caiu dentro do horizonte, ou frequência finita).
  const isExhausted = nextRunAfterHorizon === null;

  return { occurrences, nextRunAfterHorizon, isExhausted };
}

/**
 * Valida que uma string `YYYY-MM-DD` é uma data de calendário plausível.
 * Utilitário interno reutilizável em validações futuras.
 */
export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return !Number.isNaN(parsed.getTime());
}
