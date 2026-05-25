import type { Metadata } from 'next';

import { AppShell } from '@/components/shell/AppShell';

export const metadata: Metadata = {
  title: 'Expressia',
};

/**
 * Layout do route group `(app)/` — rotas autenticadas.
 *
 * Story 5.3 substitui o placeholder Story 1.5 (header horizontal de 59 linhas)
 * pelo `<AppShell>` 3-zonas (sidebar fixa 240px + main + chat panel slot).
 * O layout fica fino — apenas declara `metadata` + delega ao `AppShell` que
 * orquestra Sidebar, TopBar (com avatar + logoutAction), main e ChatPanelSlot.
 *
 * Contracts preservados:
 *   - `export default AppLayout({ children })` (Next.js App Router exige)
 *   - `export const metadata` byte-a-byte
 *   - Server Component (sem `'use client'`)
 *   - `logoutAction` Server Action invocada via `<form action={logoutAction}>`
 *     dentro do `TopBar` (Story 1.5 D15 inalterado)
 *   - `apps/web/src/middleware.ts` NÃO tocado (auth gate intacto;
 *     DP-5.3.E carry-over folded em Story 5.10)
 *
 * Trace: Story 5.3 AC1; Story 1.5 Task 7 (D13/D15); Architecture §8.1.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
