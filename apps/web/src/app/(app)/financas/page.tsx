import { redirect } from 'next/navigation';

/**
 * `/financas` — redirecciona para a vista por omissão `este-mes` (Story 4.6 AC1).
 *
 * A raiz do route group de Finanças não tem vista própria; `este-mes` é a
 * vista canónica de entrada do módulo.
 */
export default function FinancasIndexPage(): never {
  redirect('/financas/este-mes');
}
