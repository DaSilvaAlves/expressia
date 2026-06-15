import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Termos de Serviço',
  description:
    'Termos e condições de utilização da Expressia: conta e elegibilidade, período experimental, utilização aceitável, propriedade intelectual e lei aplicável.',
};

/**
 * Página pública `/termos` — Termos de Serviço.
 *
 * Server Component estático (sem dados, sem sessão) — vive FORA dos grupos
 * `(app)` e `(auth)`, à semelhança de `/` e `/privacidade`.
 *
 * RASCUNHO jurídico PT-PT a validar pelo Eurico. Os campos `[...]` marcam dados
 * que só a entidade detém (comarca do foro). NÃO inventar valores.
 *
 * Estilo coerente com `/privacidade`: tokens do design system, `font-serif` nos
 * títulos, legível, responsivo e dark-mode-ready. Hierarquia h1 > h2 (a11y).
 *
 * Trace: prontidão soft-launch; coerência visual com `/` e `/privacidade`.
 */
export default function TermosPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-foreground">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {/* Aviso de rascunho — a remover após validação jurídica. */}
        <p
          role="note"
          className="rounded-md border border-warning bg-warning-subtle px-4 py-3 text-sm font-medium text-foreground"
        >
          RASCUNHO — sujeito a validação jurídica antes do lançamento público.
        </p>

        <header className="flex flex-col gap-2">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-primary">
            Termos de Serviço
          </h1>
          <p className="text-sm text-muted-foreground">
            Data de entrada em vigor: [DD/MM/YYYY]
          </p>
        </header>

        <p className="text-base leading-relaxed">
          Os presentes Termos de Serviço regem a utilização da Expressia (&laquo;o Serviço&raquo;).
          Ao criar uma conta ou utilizar o Serviço, aceitas integralmente estes Termos. Se não
          concordas com eles, não deves utilizar o Serviço.
        </p>

        {/* 1. Objeto */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">1. Objeto do serviço</h2>
          <p className="text-base leading-relaxed">
            A Expressia é um assistente em português europeu que permite organizar tarefas, gerir
            finanças pessoais e familiares e automatizar rotinas, com recurso a inteligência
            artificial. O Serviço destina-se exclusivamente a utilizadores em Portugal continental.
          </p>
        </section>

        {/* 2. Conta e elegibilidade */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            2. Conta e elegibilidade
          </h2>
          <p className="text-base leading-relaxed">
            Para utilizar o Serviço deves ter, no mínimo, 18 anos de idade e capacidade jurídica
            para celebrar contratos. És responsável por manter a confidencialidade das tuas
            credenciais de acesso e por todas as atividades realizadas na tua conta. Os dados que
            forneces no registo devem ser verdadeiros e atualizados.
          </p>
        </section>

        {/* 3. Período experimental e subscrição */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            3. Período experimental e subscrição
          </h2>
          <p className="text-base leading-relaxed">
            O Serviço disponibiliza um período experimental gratuito de 14 dias, sem necessidade de
            cartão de pagamento. Findo esse período, a continuação da utilização poderá depender da
            adesão a uma subscrição paga, cujas condições e preços serão comunicados antecipadamente
            antes de qualquer cobrança.
          </p>
        </section>

        {/* 4. Utilização aceitável */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            4. Utilização aceitável
          </h2>
          <p className="text-base leading-relaxed">
            Comprometes-te a utilizar o Serviço de forma lícita e a não:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-base leading-relaxed">
            <li>Violar qualquer lei aplicável ou direitos de terceiros;</li>
            <li>
              Tentar aceder, sem autorização, a dados de outros utilizadores ou agregados
              familiares;
            </li>
            <li>
              Comprometer a segurança, a integridade ou a disponibilidade do Serviço (por exemplo,
              através de ataques, engenharia reversa ou utilização automatizada abusiva);
            </li>
            <li>Utilizar o Serviço para fins fraudulentos, ilícitos ou prejudiciais.</li>
          </ul>
        </section>

        {/* 5. Propriedade intelectual */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            5. Propriedade intelectual
          </h2>
          <p className="text-base leading-relaxed">
            A marca &laquo;Expressia&raquo; e os respetivos sinais distintivos são propriedade da
            entidade responsável e não podem ser utilizados sem autorização. O software subjacente é
            distribuído ao abrigo da licença <strong>AGPL-3.0</strong>, nos termos da qual o
            código-fonte está disponível publicamente. Os dados que inseres no Serviço continuam a
            ser teus; concedes-nos apenas a autorização necessária para os tratar e te prestar o
            Serviço.
          </p>
        </section>

        {/* 6. Isenção de garantias e limitação de responsabilidade */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            6. Isenção de garantias e limitação de responsabilidade
          </h2>
          <p className="text-base leading-relaxed">
            O Serviço é fornecido &laquo;tal como está&raquo; e &laquo;conforme disponível&raquo;,
            sem garantias de qualquer natureza, expressas ou implícitas. Não garantimos que o Serviço
            esteja livre de erros ou interrupções. Na medida máxima permitida pela lei, a nossa
            responsabilidade por danos decorrentes da utilização do Serviço é limitada. As decisões
            tomadas com base nas sugestões do assistente de inteligência artificial são da tua
            responsabilidade.
          </p>
        </section>

        {/* 7. Suspensão e cessação */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            7. Suspensão e cessação da conta
          </h2>
          <p className="text-base leading-relaxed">
            Podes encerrar a tua conta a qualquer momento. Reservamo-nos o direito de suspender ou
            cessar o acesso ao Serviço em caso de incumprimento destes Termos ou de utilização que
            comprometa a segurança ou os direitos de terceiros, sem prejuízo dos teus direitos sobre
            os dados pessoais previstos na{' '}
            <Link
              href="/privacidade"
              className="text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              Política de Privacidade
            </Link>
            .
          </p>
        </section>

        {/* 8. Lei aplicável e foro */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            8. Lei aplicável e foro
          </h2>
          <p className="text-base leading-relaxed">
            Os presentes Termos regem-se pela lei portuguesa. Para a resolução de quaisquer litígios
            emergentes da sua interpretação ou execução, é competente o foro da comarca de{' '}
            <strong>[comarca]</strong>, com expressa renúncia a qualquer outro.
          </p>
        </section>

        {/* 9. Contacto */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">9. Contacto</h2>
          <p className="text-base leading-relaxed">
            Para qualquer questão relativa a estes Termos, contacta-nos através de{' '}
            <strong>[email de contacto, ex.: suporte@expressia.pt]</strong>.
          </p>
        </section>

        <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border-default pt-6 text-sm">
          <Link
            href="/"
            className="text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Voltar ao início
          </Link>
          <Link
            href="/privacidade"
            className="text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Política de Privacidade
          </Link>
        </footer>
      </article>
    </main>
  );
}
