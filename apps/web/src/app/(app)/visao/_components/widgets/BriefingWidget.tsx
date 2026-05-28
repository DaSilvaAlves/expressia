import type * as React from 'react';

import { getBriefing } from '@/lib/visao/queries';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<BriefingWidget>` — widget `briefing` (Story 5.6 AC4).
 *
 * Consome `getBriefing()` (stub Story 5.5 — `available:false`). Enquanto o
 * briefing real não existe, mostra `message` ("Briefing diário disponível em
 * breve."). Sem rodapé (CO-5.5.B). Forward-compatible: quando `available:true`,
 * mostra a mensagem gerada.
 *
 * Trace: Story 5.6 AC4 (linha briefing); CO-5.5.B.
 */
export async function BriefingWidget(): Promise<React.ReactElement> {
  // Stub síncrono — `await` por uniformidade com os restantes widgets async.
  const briefing = await Promise.resolve(getBriefing());

  return (
    <WidgetCard title="Briefing diário">
      <p className="text-neutral-600 dark:text-neutral-400">{briefing.message}</p>
    </WidgetCard>
  );
}
