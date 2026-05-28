/**
 * Helpers puros da saudação contextual do header `/visao` (Story 5.6 AC2 / DP-5.6.D).
 *
 * - `getGreeting(date)` — devolve a saudação por hora do dia em Europe/Lisbon.
 * - `resolveDisplayName(user)` — resolve o nome a apresentar a partir do objecto
 *   `user` do Supabase. **Não inventa campos** — só lê `user_metadata.name`/
 *   `full_name` e a parte local do email (capitalizada) como fallback.
 *
 * Ambos são funções puras e testáveis (AC9.a — `vi.setSystemTime` para os ramos).
 *
 * Trace: Story 5.6 AC2(a)(b); front-end-spec §5.4 l.496; D-5.5.4 (timezone
 * Europe/Lisbon coerente com as queries 5.5).
 */

export type Greeting = 'Bom dia' | 'Boa tarde' | 'Boa noite';

/**
 * Subconjunto do objecto `user` do Supabase que esta saudação consome.
 * Apenas campos garantidamente presentes — sem inventar (DP-5.6.D).
 */
export interface GreetingUser {
  readonly email?: string | null;
  readonly user_metadata?: {
    readonly name?: string | null;
    readonly full_name?: string | null;
  } | null;
}

/**
 * Devolve a hora do dia (0-23) em Europe/Lisbon para um dado instante.
 * Usa `Intl.DateTimeFormat` com `hour12: false` — aplica o offset DST correcto
 * independentemente do timezone do servidor.
 */
function getLisbonHour(date: Date): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    hour12: false,
  }).format(date);
  // `en-GB` com `hour12:false` pode devolver '24' à meia-noite — normalizar p/ 0.
  const hour = parseInt(formatted, 10);
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/**
 * Saudação por hora do dia (Europe/Lisbon — AC2.a):
 *   - `Bom dia`   → hora < 12
 *   - `Boa tarde` → 12 ≤ hora < 20
 *   - `Boa noite` → hora ≥ 20
 */
export function getGreeting(date: Date): Greeting {
  const hour = getLisbonHour(date);
  if (hour < 12) return 'Bom dia';
  if (hour < 20) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Capitaliza a primeira letra de uma string (resto inalterado).
 * Ex: `'joao'` → `'Joao'`. String vazia devolve-se inalterada.
 */
function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Formata a linha de data do header (AC2.c): `"{dia-da-semana}, DD/MM/YYYY"`
 * em PT-PT, timezone Europe/Lisbon, com `weekday: 'long'`.
 *
 * Ex (2026-03-14, um sábado): `"sábado, 14/03/2026"`. O chamador embrulha em
 * `"Hoje é {…}."`. Formato de data DD/MM/YYYY (CON / language-standards).
 *
 * Função pura testável — `Intl.DateTimeFormat` aplica o offset DST correcto.
 */
export function formatGreetingDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    weekday: 'long',
  }).format(date);

  const ddmmyyyy = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  return `${weekday}, ${ddmmyyyy}`;
}

/**
 * Resolve o nome a apresentar no header (AC2.b):
 *   1. `user_metadata.name` (se presente e não vazio após trim);
 *   2. `user_metadata.full_name` (idem);
 *   3. parte local do email antes de `@`, capitalizada;
 *   4. fallback final `'Olá'`-friendly: `'amigo'` se nem email existir.
 *
 * **Não inventa campos** — só lê o que o objecto `user` do Supabase garante.
 */
export function resolveDisplayName(user: GreetingUser | null | undefined): string {
  const name = user?.user_metadata?.name?.trim();
  if (name) return name;

  const fullName = user?.user_metadata?.full_name?.trim();
  if (fullName) return fullName;

  const email = user?.email?.trim();
  if (email) {
    const localPart = email.split('@')[0];
    if (localPart) return capitalize(localPart);
  }

  return 'amigo';
}
