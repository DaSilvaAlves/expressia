import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description:
    'Como a Expressia recolhe, utiliza e protege os teus dados pessoais, ao abrigo do RGPD. Direitos do titular, subcontratantes e cookies.',
};

/**
 * Página pública `/privacidade` — Política de Privacidade (RGPD Art. 13.º).
 *
 * Server Component estático (sem dados, sem sessão) — vive FORA dos grupos
 * `(app)` (autenticado) e `(auth)`, à semelhança da landing `/`: é informação
 * pública acessível a qualquer visitante.
 *
 * RASCUNHO jurídico PT-PT: o conteúdo é um ponto de partida a validar pelo
 * Eurico antes do lançamento. Os campos `[...]` marcam dados que só a entidade
 * responsável detém (morada, prazos, mecanismo de transferência). NÃO inventar
 * valores — o aviso de rascunho no topo é deliberadamente visível.
 *
 * Estilo: tokens do design system `@meu-jarvis/ui` (sem cores hardcoded),
 * `font-serif` nos títulos (coerente com a landing/`OnboardingTour`), legível e
 * responsivo, dark mode via classe `.dark`. Hierarquia de headings h1 > h2 para
 * a11y. Última secção liga de volta a `/` e a `/termos`.
 *
 * Trace: prontidão soft-launch (conformidade RGPD); coerência visual com `/`.
 */
export default function PrivacidadePage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-foreground">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {/* Aviso de rascunho — deliberadamente visível no topo (a remover após
            validação jurídica). Usa o token `warning` do design system. */}
        <p
          role="note"
          className="rounded-md border border-warning bg-warning-subtle px-4 py-3 text-sm font-medium text-foreground"
        >
          RASCUNHO — sujeito a validação jurídica antes do lançamento público.
        </p>

        <header className="flex flex-col gap-2">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-primary">
            Política de Privacidade
          </h1>
          <p className="text-sm text-muted-foreground">
            Última actualização: [DD/MM/YYYY] · Data de entrada em vigor: [DD/MM/YYYY]
          </p>
        </header>

        <p className="text-base leading-relaxed">
          A presente Política de Privacidade descreve como a Expressia recolhe, utiliza, conserva e
          protege os dados pessoais dos seus utilizadores, em conformidade com o Regulamento Geral
          sobre a Proteção de Dados (Regulamento (UE) 2016/679, &laquo;RGPD&raquo;) e com a
          legislação portuguesa aplicável. A Expressia é um serviço destinado exclusivamente a
          Portugal continental.
        </p>

        {/* 1. Responsável pelo tratamento */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            1. Responsável pelo tratamento
          </h2>
          <p className="text-base leading-relaxed">
            O responsável pelo tratamento dos teus dados pessoais é{' '}
            <strong>[NOME LEGAL DA ENTIDADE / Eurico ...]</strong>, com morada em{' '}
            <strong>[MORADA]</strong>. Para qualquer questão relacionada com a proteção de dados,
            podes contactar-nos através de{' '}
            <strong>[email de contacto, ex.: privacidade@expressia.pt]</strong>.
          </p>
        </section>

        {/* 2. Que dados recolhemos */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            2. Que dados recolhemos
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Dados de conta:</strong> endereço de email e nome, fornecidos no registo.
            </li>
            <li>
              <strong>Dados que o utilizador insere:</strong> tarefas, transações e dados
              financeiros, bem como informação sobre o agregado familiar (household) e os seus
              membros.
            </li>
            <li>
              <strong>Dados técnicos de utilização:</strong> registos de atividade (logs) e cookies
              de sessão necessários para autenticar e manter a sessão iniciada.
            </li>
          </ul>
        </section>

        {/* 3. Finalidades e base legal */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            3. Finalidades e base legal do tratamento
          </h2>
          <p className="text-base leading-relaxed">
            Tratamos os teus dados para as seguintes finalidades:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Prestação do serviço</strong> (execução do contrato, Art. 6.º, n.º 1, al. b)
              do RGPD): criar e gerir a tua conta, guardar e processar as tarefas e os dados
              financeiros que inseres.
            </li>
            <li>
              <strong>Funcionamento e segurança da conta</strong> (interesse legítimo, Art. 6.º, n.º
              1, al. f): prevenir abusos, garantir a integridade dos dados e o isolamento entre
              agregados familiares.
            </li>
            <li>
              <strong>Processamento por inteligência artificial</strong>: interpretar e executar os
              pedidos que envias ao assistente, conforme descrito na secção seguinte.
            </li>
          </ul>
        </section>

        {/* 4. IA e dados */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            4. Inteligência artificial e processamento de mensagens
          </h2>
          <p className="text-base leading-relaxed">
            As mensagens que envias ao assistente são processadas por subcontratantes de
            inteligência artificial (Anthropic e OpenAI) para interpretar e executar os teus
            pedidos. Estas mensagens podem conter dados financeiros (por exemplo, ao registar uma
            despesa por escrito), pelo que recomendamos que partilhes apenas a informação necessária
            ao pedido. Os subcontratantes de IA tratam estes dados exclusivamente para devolver a
            resposta ao serviço e não os utilizam para treinar os seus modelos.
          </p>
        </section>

        {/* 5. Destinatários / subcontratantes */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            5. Destinatários e subcontratantes (subprocessadores)
          </h2>
          <p className="text-base leading-relaxed">
            Para prestar o serviço, recorremos aos seguintes subcontratantes, que tratam dados em
            nosso nome e ao abrigo de acordos de tratamento de dados:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-base leading-relaxed">
            <li>
              <strong>Supabase</strong> — base de dados (região Frankfurt, UE).
            </li>
            <li>
              <strong>Vercel</strong> — alojamento e infraestrutura web (região fra1, UE).
            </li>
            <li>
              <strong>Resend</strong> — envio de email transacional.
            </li>
            <li>
              <strong>Anthropic</strong> e <strong>OpenAI</strong> — processamento por inteligência
              artificial.
            </li>
            <li>
              <strong>Stripe</strong> — processamento de pagamentos (apenas quando a subscrição paga
              for ativada; atualmente inativo).
            </li>
          </ul>
        </section>

        {/* 6. Transferências internacionais */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            6. Transferências internacionais de dados
          </h2>
          <p className="text-base leading-relaxed">
            A base de dados e o alojamento estão localizados na União Europeia. No entanto, o
            processamento por inteligência artificial (Anthropic, OpenAI) pode implicar a
            transferência de dados para fora do Espaço Económico Europeu, nomeadamente para os
            Estados Unidos da América. Tais transferências realizam-se ao abrigo de cláusulas
            contratuais-tipo (Standard Contractual Clauses — SCC) aprovadas pela Comissão Europeia.{' '}
            <strong>[confirmar mecanismo de transferência]</strong>.
          </p>
        </section>

        {/* 7. Período de conservação */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            7. Período de conservação
          </h2>
          <p className="text-base leading-relaxed">
            Conservamos os teus dados pessoais enquanto a tua conta se mantiver ativa. Após o
            encerramento da conta ou na sequência de um pedido de eliminação, os dados são apagados
            no prazo de <strong>[definir prazo]</strong>, salvo obrigação legal de conservação por
            período superior.
          </p>
        </section>

        {/* 8. Direitos do titular */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            8. Direitos do titular dos dados
          </h2>
          <p className="text-base leading-relaxed">
            Nos termos do RGPD, assistem-te os seguintes direitos relativamente aos teus dados
            pessoais:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-base leading-relaxed">
            <li>Direito de acesso aos teus dados;</li>
            <li>Direito de rectificação de dados inexactos ou incompletos;</li>
            <li>
              Direito de eliminação (&laquo;direito a ser esquecido&raquo;);
            </li>
            <li>Direito à limitação do tratamento;</li>
            <li>Direito à portabilidade dos dados;</li>
            <li>Direito de oposição ao tratamento.</li>
          </ul>
          <p className="text-base leading-relaxed">
            Para exercer qualquer um destes direitos, contacta-nos através do email indicado na
            secção 1. Tens ainda o direito de apresentar reclamação junto da autoridade de controlo
            competente, a <strong>Comissão Nacional de Proteção de Dados (CNPD)</strong>.
          </p>
        </section>

        {/* 9. Cookies */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">9. Cookies</h2>
          <p className="text-base leading-relaxed">
            Utilizamos apenas cookies essenciais de sessão, necessários para autenticar o utilizador
            e manter a sessão iniciada. Estes cookies são indispensáveis ao funcionamento do serviço
            e não dependem de consentimento prévio. Não utilizamos cookies de publicidade nem de
            rastreio de terceiros para fins de marketing.
          </p>
        </section>

        {/* 10. Alterações */}
        <section className="flex flex-col gap-3">
          <h2 className="font-serif text-2xl font-semibold text-primary">
            10. Alterações a esta política
          </h2>
          <p className="text-base leading-relaxed">
            Podemos atualizar esta Política de Privacidade sempre que necessário. Qualquer alteração
            relevante será comunicada através do serviço. A presente versão entra em vigor a{' '}
            <strong>[DD/MM/YYYY]</strong>.
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
            href="/termos"
            className="text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Termos de Serviço
          </Link>
        </footer>
      </article>
    </main>
  );
}
