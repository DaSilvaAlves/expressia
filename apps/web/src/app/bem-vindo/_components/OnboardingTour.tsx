'use client';

/**
 * `<OnboardingTour>` — stepper Client do tour de onboarding (Story 6.2).
 *
 * Tour de **2 passos** (DP-6.2.1=B seguir spec + DP-6.2.2=A remover o Passo 1
 * "nome/agregado" do front-end-spec §5.3 — já capturado no registo; rename de
 * household = Fase 2):
 *
 *   Passo 1 — Demo multi-intent SIMULADO (DP-6.2.3=B): mostra uma frase-exemplo;
 *     "Mostrar o que acontece" revela um preview canned estático (tarefa +
 *     despesa + recorrente). **Sem chamadas LLM, sem escrever em DB** — é uma
 *     demonstração determinística do diferenciador (AC3).
 *   Passo 2 — Trial (AC4): "14 dias grátis, sem cartão", planos (Premium €8,88
 *     destacado), microcopy anti-pressão. Read-only sobre `subscriptions`.
 *
 * "Saltar tudo" (Passo 1) e "Começar a usar" (Passo 2) submetem o mesmo server
 * action `completeAction` (marca onboarding + redirect `/visao?welcome=1`).
 * FR31: saltar mantém o trial (AC6).
 *
 * **SSR-safety (lição FIX-1 da 5.7):** todo o estado (`step`, `revealed`) é
 * `useState` mutado só em handlers/effects — nunca no corpo do render.
 *
 * **A11y:** progress com `role="progressbar"` + `aria-valuenow/min/max`; passos
 * anunciados; botões com foco visível e navegáveis por teclado; PT-PT (CON3).
 *
 * Trace: Story 6.2 AC1/AC3/AC4/AC5/AC6; front-end-spec §5.3.
 */
import { useState } from 'react';

const TOTAL_STEPS = 2;

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-primary-hover disabled:opacity-60';
const GHOST_BUTTON =
  'rounded-md px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
const SECONDARY_BUTTON =
  'rounded-md border border-border-default px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

interface OnboardingTourProps {
  /** Server action: marca o onboarding como visto e redirecciona para `/visao`. */
  completeAction: () => Promise<void>;
}

export function OnboardingTour({ completeAction }: OnboardingTourProps): React.ReactElement {
  const [step, setStep] = useState<1 | 2>(1);
  const [revealed, setRevealed] = useState(false);

  const progressPct = Math.round((step / TOTAL_STEPS) * 100);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-8">
      {/* Cabeçalho: progresso */}
      <div className="mb-10">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-serif text-lg font-semibold tracking-tight">Expressia</span>
          <span className="text-xs font-medium text-text-muted">
            Passo {step} de {TOTAL_STEPS}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-bg-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progresso do onboarding: passo ${step} de ${TOTAL_STEPS}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Conteúdo do passo */}
      <div className="flex flex-1 flex-col justify-center">
        {step === 1 ? (
          <section aria-labelledby="onb-step1-title">
            <h1 id="onb-step1-title" className="font-serif text-3xl font-semibold tracking-tight">
              Escreve uma frase. Vais ver.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-text-muted">
              O Expressia detecta tudo o que tens dentro de uma frase e organiza por ti.
              Experimenta com isto:
            </p>

            <blockquote className="mt-5 rounded-lg border border-border-default bg-surface px-4 py-3 text-sm text-foreground">
              Reunião com a Marta amanhã às 15h. Paguei €78,70 no continente. Lembra-me de
              pagar a renda dia 8.
            </blockquote>

            {!revealed ? (
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className={`mt-5 ${PRIMARY_BUTTON}`}
              >
                Mostrar o que acontece
              </button>
            ) : (
              <ul className="mt-5 space-y-2 text-sm" aria-live="polite">
                <li className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  <span>
                    <strong>Tarefa criada:</strong> &quot;Reunião com a Marta&quot; amanhã às
                    15:00
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  <span>
                    <strong>Despesa registada:</strong> €78,70 no Continente (Mercearia)
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  <span>
                    <strong>Recorrente criada:</strong> Renda, todo o dia 8
                  </span>
                </li>
              </ul>
            )}
          </section>
        ) : (
          <section aria-labelledby="onb-step2-title">
            <h1 id="onb-step2-title" className="font-serif text-3xl font-semibold tracking-tight">
              Tens 14 dias grátis.
            </h1>
            <p className="mt-2 text-sm text-text-muted">Sem cartão, sem compromisso.</p>

            <p className="mt-5 text-sm font-medium text-foreground">No fim, podes:</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="rounded-lg border border-border-default px-4 py-3">
                Ficar no plano <strong>Grátis</strong> — 1 módulo, 50 prompts
              </li>
              <li className="rounded-lg border border-border-default px-4 py-3">
                Subir para <strong>Pessoal €4,90/mês</strong>
              </li>
              <li className="rounded-lg border border-primary bg-surface px-4 py-3">
                Ou <strong>Premium €8,88/mês</strong> — tudo incluído
              </li>
            </ul>

            <p className="mt-5 text-sm leading-relaxed text-text-muted">
              Não decides agora. Só te avisamos no dia 12 por email. Sem surpresas.
            </p>
          </section>
        )}
      </div>

      {/* Rodapé: navegação. "Saltar tudo" e "Começar a usar" invocam o mesmo
          server action `completeAction` (marca onboarding + redirect /visao). */}
      <div className="mt-10 flex items-center justify-between gap-3">
        {step === 1 ? (
          <>
            <button
              type="button"
              onClick={() => {
                void completeAction();
              }}
              className={GHOST_BUTTON}
            >
              Saltar tudo
            </button>
            <button type="button" onClick={() => setStep(2)} className={PRIMARY_BUTTON}>
              Continuar →
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep(1)} className={SECONDARY_BUTTON}>
              ← Voltar
            </button>
            <button
              type="button"
              onClick={() => {
                void completeAction();
              }}
              className={PRIMARY_BUTTON}
            >
              Começar a usar
            </button>
          </>
        )}
      </div>
    </main>
  );
}
