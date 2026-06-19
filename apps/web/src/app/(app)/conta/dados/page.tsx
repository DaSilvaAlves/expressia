import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

import { ExportData } from './_components/export-data';

export const metadata: Metadata = {
  title: 'Os meus dados — Expressia',
};

/**
 * Página `/conta/dados` — "Os meus dados" (Story 6.8 AC6).
 *
 * Server Component que exige sessão (redirect para `/entrar` sem utilizador),
 * seguindo o padrão de `conta/preferencias/page.tsx` e `conta/household/page.tsx`.
 * A interactividade (botão de export + estados) vive no Client Component
 * `<ExportData>`. A geração é síncrona (PO-D1), feita no `POST /api/conta/export`.
 *
 * Direito de portabilidade de dados — RGPD Art. 20.º (FR28).
 *
 * Trace: Story 6.8 AC6; FR28; CON3; padrão `conta/preferencias/page.tsx`.
 */
export default async function DadosPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/entrar');
  }

  return (
    <div className="space-y-6">
      <div>
        <nav className="text-xs text-muted-foreground" aria-label="Breadcrumb">
          Conta › Os meus dados
        </nav>
        <h1 className="mt-1 text-2xl font-bold">Os meus dados</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Descarrega uma cópia completa dos teus dados, ao abrigo do teu direito de
          portabilidade de dados (RGPD, Artigo 20.º).
        </p>
      </div>

      <ExportData />

      <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        <h2 className="text-sm font-medium text-foreground">O que está incluído</h2>
        <p className="mt-1">
          A exportação inclui as tuas tarefas e recorrências, etiquetas, colunas Kanban,
          contas, cartões, transações, recorrências e prestações financeiras, as tuas
          categorias próprias, os dados e membros da tua conta, as tuas preferências e o
          registo de auditoria da conta.
        </p>
        <h2 className="mt-3 text-sm font-medium text-foreground">O que não está incluído</h2>
        <p className="mt-1">
          Não estão incluídos os dados de faturação e subscrição, as categorias
          predefinidas globais da aplicação, nem registos técnicos externos de
          monitorização. Os valores monetários são apresentados em cêntimos e também em
          euros (formato português, com vírgula decimal).
        </p>
      </div>
    </div>
  );
}
