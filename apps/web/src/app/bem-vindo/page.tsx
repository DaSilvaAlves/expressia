import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { completeOnboarding } from '@/app/bem-vindo/actions';
import { OnboardingTour } from '@/app/bem-vindo/_components/OnboardingTour';

/**
 * `/bem-vindo` — Tour de onboarding pós-registo (Story 6.2).
 *
 * Server Component: garante sessão (defensivo — o middleware já redirecciona
 * anónimos via `APP_PATH_PREFIXES`) e monta o stepper Client `<OnboardingTour>`.
 *
 * Âmbito (DPs travadas pelo @po): tour de **2 passos** (DP-6.2.2=A — o Passo 1
 * "nome/agregado" do front-end-spec §5.3 está superado: nome capturado no
 * registo e household `'Casa de {nome}'` via trigger 0019; rename = Fase 2):
 *   - Passo 1: demo multi-intent SIMULADO (DP-6.2.3=B — sem LLM, sem writes);
 *   - Passo 2: explicação do trial 14d (read-only sobre `subscriptions`).
 *
 * `completeOnboarding` (server action) marca `user_prefs.onboarding_completed_at`
 * e redirecciona para `/visao?welcome=1` — tanto no "Saltar tudo" como no
 * "Começar a usar" (FR31: saltar mantém o trial; AC6/AC7).
 *
 * Trace: Story 6.2 AC1/AC3/AC4/AC5/AC6/AC7; front-end-spec §5.3.
 */
export default async function BemVindoPage(): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  return <OnboardingTour completeAction={completeOnboarding} />;
}
