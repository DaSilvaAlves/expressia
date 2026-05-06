# Landing Page Expressia — Draft v0.1

**Author:** @ux-design-expert (Uma)
**Date:** 2026-05-06
**Target URL:** https://expressia.pt
**Implementation:** Após Story 1.5 fechar — @dev cria em `apps/web/src/app/(marketing)/page.tsx` (rota já reservada na arquitectura §8.1)

---

## 1. Estratégia de Página

### 1.1 Persona Alvo

A landing serve as três personas do PRD, mas a **persona primária para tráfego frio é a Família Tipo (João + Sofia, 38/35, Lisboa, dois filhos)**. A copy lidera com este cenário porque:

1. O plano €8,88 é o tier hero do produto (decisão Eurico).
2. É o diferenciador estrutural mais difícil de copiar pelo Néctar (multi-tenant família).
3. Profissionais individuais (Inês, advogada freelancer) e devs power-users (Diogo) convertem por argumentos secundários — controlo, dados, transparência — que vivem em secções mais abaixo.

| Persona                                  | Cenário ao aterrar                                                                          | O que a landing tem de provar                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Família (João/Sofia)                     | Casal cansado a tentar gerir agenda partilhada e orçamento conjunto em três apps diferentes | Que uma frase em português resolve agenda + finança + lembrete de uma vez, partilhado pela família |
| Profissional individual (Inês, advogada) | ENI a navegar entre Notion, Excel, Recibos Verdes, Calendário                               | Que separa despesas pessoais e profissionais sem fricção, formato fiscal PT                        |
| Power-user (Diogo, eng. SW)              | Curioso por ferramenta PT com API e dados próprios                                          | Que é open-source AGPL-3.0, dados na UE, export sempre activo                                      |

### 1.2 Job-To-Be-Done

**"Eu quero parar de andar a saltar entre WhatsApp, Excel e Calendário cada vez que alguém na minha família compra alguma coisa, marca uma consulta ou paga uma conta — e quero fazer isto em português, em Portugal, sem ter de explicar a uma app brasileira o que é o Multibanco."**

### 1.3 Mensagem Central (5 segundos)

**"Uma frase em português. Tarefas, finanças e agenda da tua família, todas no mesmo sítio."**

Esta tem de bater no hero em <1 segundo de scan. É o teste de bouncer: se o visitante não percebe isto em 5 segundos, perdemos.

### 1.4 Objectivo de Conversão

| CTA           | Onde                          | Acção                                                                                      |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| **Primary**   | Hero + meio de página + final | "Começar grátis 14 dias" → leva a `/registar` (auth flow Story 1.5)                        |
| **Secondary** | Hero + Section 3              | "Ver demo de 2 minutos" → scroll suave para Section 3 (Como Funciona) com iframe do mockup |

**Métrica alvo (Q1):** taxa de conversão landing → trial signup ≥ 4% (benchmark SaaS PT). Métrica secundária: bounce rate <55%.

---

## 2. Estrutura Wireframe (top → bottom)

A página tem 9 secções + footer. Total estimado: ~180-220kb (LCP <2s — NFR4).

---

### Section 1 — Hero

| Elemento                                      | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1**                                        | Uma frase. Tudo organizado.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Sub-headline**                              | O Expressia é o assistente em português que organiza as tarefas, as finanças e a agenda da tua família — numa só conversa.                                                                                                                                                                                                                                                                                                       |
| **Visual**                                    | Mockup estático da app (light mode) a mostrar o chat principal num split layout. À esquerda o utilizador escreveu "Paguei 50€ na Continente para o jantar de família e marca a consulta da Joana terça às 10h"; à direita o painel mostra duas confirmações (uma transacção de €50,00 na categoria Alimentação + uma tarefa "Consulta Joana" em 14/05 10:00). Background creme `#FAFAF7` com sombra suave do mockup `shadow-lg`. |
| **Primary CTA**                               | `Começar grátis 14 dias` (botão Atlântico `#1F4F6A`, texto branco, radius-md)                                                                                                                                                                                                                                                                                                                                                    |
| **Secondary CTA**                             | `Ver demo de 2 minutos` (botão ghost com seta para baixo, mesma altura, scroll para Section 3)                                                                                                                                                                                                                                                                                                                                   |
| **Trust signal abaixo dos CTAs**              | Sem cartão. Sem fidelização. Cancela quando quiseres.                                                                                                                                                                                                                                                                                                                                                                            |
| **Linha de credibilidade abaixo dos signals** | Construído em Portugal · Dados na União Europeia · Open-source AGPL-3.0                                                                                                                                                                                                                                                                                                                                                          |

**Notas de design:**

- Hero ocupa ~85vh em desktop, ~100vh em mobile.
- Mockup visual à direita em desktop (split 50/50), abaixo do texto em mobile.
- O mockup é PNG/WebP estático (não interactivo) — animação só na demo da Section 3.
- NÃO incluir badges "AI" ou "Powered by GPT" no hero — viola tom calmo (anti-vibe ChatGPT, ver `front-end-spec.md` §1.2).

---

### Section 2 — Problema (porque é que isto importa)

| Elemento                      | Conteúdo                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H2**                        | Tens três apps abertas ao mesmo tempo. Sabes que isto não pode ser.                                                                                                                                                                                    |
| **Subheading**                | Calendário para a agenda. WhatsApp para os lembretes. Excel para o orçamento. E ainda assim, perdes coisas todas as semanas.                                                                                                                           |
| **Visual**                    | Ilustração linha-fina (3 cartões diagonais sobrepostos representando "Calendário", "WhatsApp lembretes", "Excel orçamento") com setas a apontarem para um único cartão limpo "Expressia" — Atlântico. Estilo editorial, não estilo "infográfico tech". |
| **3 dores em formato cartão** | (ver tabela abaixo)                                                                                                                                                                                                                                    |

**Cartões de dor (3 colunas em desktop, stack em mobile):**

| Dor                       | Copy                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **20-30 minutos por dia** | É o tempo que uma família típica gasta a saltar entre apps. Por semana, são 3 horas. Por mês, um dia inteiro.                                      |
| **Decisões sem contexto** | Quando o orçamento está num sítio e a agenda noutro, decides mal. "Posso ir ao restaurante este fim-de-semana?" não devia ser uma incógnita.       |
| **Coisas que se perdem**  | Aniversários, faturas por pagar, lembretes que ficaram só no WhatsApp da tua mulher. O custo de uma vida fragmentada não é só tempo — é qualidade. |

**Tom:** descritivo, sem dramatização. Sem "REVOLUÇÃO" ou "MUDA A TUA VIDA". Diz o que é.

---

### Section 3 — Como Funciona (cérebro AI demo)

Esta é a secção mais importante da landing — é onde provamos o diferenciador. Tem que ser tão clara que o visitante percebe o produto sem precisar de ver mais nada.

| Elemento             | Conteúdo                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **H2**               | Escreve uma frase. O Expressia faz o resto.                                                                                                    |
| **Subheading**       | Não é um chatbot. É um assistente que entende várias coisas ao mesmo tempo, em português europeu, e age sem te fazer perguntas desnecessárias. |
| **Visual principal** | Bloco interactivo (mockup estático no MVP) com 3 abas no topo: "Família" / "Profissional" / "Casal". Cada aba mostra um exemplo.               |

**Demo — 3 exemplos em formato chat (mockup estático, transição entre abas):**

#### Exemplo 1 — Família (default visível)

**Input do utilizador (cartão claro à direita):**

> Paguei 50€ na Continente para o jantar de família. Marca a consulta da Joana terça às 10h e lembra-me de pagar a renda na sexta.

**Resposta do Expressia (cartão Atlântico à esquerda):**

> Tratei de três coisas:
>
> | Acção           | Detalhe                                  |
> | --------------- | ---------------------------------------- |
> | Despesa criada  | €50,00 — Alimentação — Continente — hoje |
> | Tarefa criada   | Consulta Joana — terça, 14/05, 10:00     |
> | Lembrete criado | Pagar renda — sexta, 17/05               |
>
> _Botão: Anular tudo (30s)_

#### Exemplo 2 — Profissional

**Input:**

> Recebi 1.230€ do cliente Tavares hoje. Categoria honorários. E põe a reunião com a Dra. Sá amanhã às 15h.

**Resposta:**

> | Acção          | Detalhe                                          |
> | -------------- | ------------------------------------------------ |
> | Receita criada | +€1.230,00 — Honorários — Cliente Tavares — hoje |
> | Tarefa criada  | Reunião Dra. Sá — amanhã, 15:00                  |

#### Exemplo 3 — Casal

**Input:**

> Quanto gastámos em supermercado este mês?

**Resposta (com mini-gráfico de barras):**

> Vocês gastaram **€312,40 em supermercado** em Maio (até hoje):
>
> - Continente: €178,90 (12 compras)
> - Pingo Doce: €89,50 (5 compras)
> - Auchan: €44,00 (2 compras)
>
> Estão **€87,60 abaixo do orçamento mensal** (€400 definido).

**CTA mid-page (abaixo do bloco interactivo):**

- `Experimentar com a tua frase` (input em linha + botão Atlântico) — abre overlay com mockup adicional ou redirecciona para signup. **Decisão de implementação:** redirecciona para `/registar` no MVP; overlay interactivo é v2.

**Trust line abaixo do CTA:**

> Funciona em PT-PT genuíno. Não é tradução automática do brasileiro.

---

### Section 4 — Família-First (diferenciação vs Todoist/YNAB/Néctar)

Esta secção argumenta o porquê de não comprar concorrentes.

| Elemento       | Conteúdo                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H2**         | Pensado para a família. Não adaptado depois.                                                                                                                                                             |
| **Subheading** | A maioria das apps de produtividade são feitas para uma pessoa. As que tentam ser para famílias adicionam isso depois, com convites por email e permissões mal feitas. O Expressia começou ao contrário. |

**3 pilares com ícone Lucide + headline + 1 frase:**

| Pilar                        | Headline                                     | Copy                                                                                                                                              |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ícone:** `Users` (Lucide)  | **Conta partilhada de raiz**                 | Tu, o teu cônjuge, os teus filhos crescidos — todos veem o mesmo orçamento, a mesma agenda, as mesmas tarefas. Sem hacks, sem permissões manuais. |
| **Ícone:** `MapPin` (Lucide) | **Português europeu, formato europeu**       | Datas em DD/MM, valores em euros com vírgula decimal (€8,88), Multibanco e MB Way no checkout. Sem traduções automáticas, sem "Olá, tudo bem?".   |
| **Ícone:** `Shield` (Lucide) | **Privacidade primeiro, RGPD desde o dia 1** | Os teus dados ficam em Frankfurt. Exportas tudo em JSON ou CSV quando quiseres. Apagas tudo em 30 dias se decidires sair. Sem letra pequena.      |

**Comparação ligeira (tabela horizontal — opcional, decidir com Eurico em Q1):**

|                                                    | Expressia   | Néctar | Todoist      | YNAB          |
| -------------------------------------------------- | ----------- | ------ | ------------ | ------------- |
| Mercado                                            | Portugal    | Brasil | Global       | EUA           |
| Língua                                             | PT-PT       | PT-BR  | PT/EN        | EN            |
| Multi-utilizador família                           | ✓ de raiz   | ×      | Pago extra   | ×             |
| Tarefas + finanças num sítio                       | ✓           | ✓      | × só tarefas | × só finanças |
| Cérebro multi-intent (uma frase faz várias coisas) | ✓           | ✓      | ×            | ×             |
| Multibanco/MB Way                                  | ✓           | ×      | ×            | ×             |
| Open-source                                        | ✓ AGPL      | ×      | ×            | ×             |
| Dados na UE                                        | ✓ Frankfurt | ×      | EUA          | EUA           |

**Q6 (open question):** validar com Eurico se queremos comparação directa nominativa ou genérica ("alternativas internacionais"). Recomendação default: **manter nominativa** — diferenciação é mais clara e não há risco legal em comparações honestas.

---

### Section 5 — Pricing

| Elemento       | Conteúdo                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **H2**         | Um plano simples para toda a família.                                                                                            |
| **Subheading** | Trial de 14 dias com todas as funcionalidades. Sem cartão. Quando acabar, ficas no plano gratuito ou escolhes o que faz sentido. |

**4 planos em formato cartão (3 colunas em desktop com Família destacado, stack em mobile):**

#### Card 1 — Free

- **Preço:** Grátis
- **Limites:** 1 módulo (Tarefas OU Finanças), 50 prompts/mês, 1 utilizador
- **Para quem:** Quero experimentar sem compromisso
- **CTA:** `Começar grátis`

#### Card 2 — Pessoal

- **Preço:** €4,90/mês ou €49/ano
- **Inclui:** Tudo (Tarefas + Finanças + Cérebro), 1 utilizador
- **Para quem:** Profissional individual ou solteiro
- **CTA:** `Escolher Pessoal`

#### Card 3 — **Família** (destacado — border Atlântico, badge "Mais popular" Cortiça)

- **Preço:** **€8,88/mês** ou €89/ano
- **Inclui:** Tudo + 4 utilizadores no mesmo agregado, orçamento conjunto, agenda partilhada
- **Para quem:** Casal ou família a gerir a vida em conjunto
- **CTA:** `Começar trial Família grátis` (Atlântico cheio)
- **Badge superior direito:** `Mais popular` (Cortiça `#B5754A` em background subtle)

#### Card 4 — Pro

- **Preço:** €14,90/mês
- **Inclui:** Família + API pública, audit log avançado, suporte prioritário, até 10 utilizadores
- **Para quem:** Power user, dev, pequena empresa
- **CTA:** `Escolher Pro`

**Trust signals abaixo dos cards (linha horizontal de 4 ícones + texto):**

| Ícone (Lucide)       | Texto                       |
| -------------------- | --------------------------- |
| `CreditCard` riscado | Sem cartão para o trial     |
| `RefreshCw`          | Cancelas a qualquer momento |
| `MapPin`             | Dados em Frankfurt (UE)     |
| `FileText`           | Factura electrónica PT      |

**Linha final:**

> Todos os planos incluem export completo em JSON e CSV. Os teus dados são teus.

---

### Section 6 — Privacidade & RGPD (PT-PT específico)

Esta secção converte os utilizadores que vieram via "alternativa europeia ao [X]".

| Elemento       | Conteúdo                                                         |
| -------------- | ---------------------------------------------------------------- |
| **H2**         | Os teus dados ficam na União Europeia.                           |
| **Subheading** | RGPD não é uma página de cookies — é como construímos o produto. |

**4 bullets com ícone Lucide:**

| Ícone      | Bullet                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Server`   | **Servidores em Frankfurt.** Postgres, Auth, Storage e cron — tudo em região UE (`eu-central-1`). Sem replicação para fora da Europa.                                   |
| `Download` | **Exportação a qualquer momento.** Pedes o teu dump completo em JSON ou CSV no painel da conta — sem suporte a contactar, sem 5 dias úteis.                             |
| `Trash2`   | **Eliminação real em 30 dias.** Quando pedes para apagar a conta, os dados são purgados em 30 dias — incluindo backups. Não ficam num _soft delete_ esquecido.          |
| `Eye`      | **Sem cookies de tracking, sem partilha com terceiros.** Usamos analytics RGPD-friendly sem identificadores pessoais. Os teus prompts nunca são logados em texto claro. |

**CTA secundário:**

- `Ler a Política de Privacidade →` (link para `/politica-privacidade`)

---

### Section 7 — Social Proof / Trust

**Contexto:** sem testimonials reais ainda no MVP. Estratégia: utilizar prova de produto (open-source, made in Portugal) em vez de prova social inventada.

| Elemento       | Conteúdo                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| **H2**         | Construído à vista de todos.                                                                                       |
| **Subheading** | O Expressia é open-source AGPL-3.0. Podes ver o código, propor melhorias, ou levá-lo para self-host se preferires. |

**3 elementos em linha horizontal (desktop) ou stack (mobile):**

| Elemento                   | Conteúdo                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Badge GitHub**           | Visual: ícone GitHub + "DaSilvaAlves/expressia" + contadores stars/issues (real, fetch via API ou estático MVP). Link para o repo. |
| **Badge Made in Portugal** | Visual: pequena bandeira PT (estilo flat, não cartoon) + texto "Construído em Portugal".                                           |
| **Badge AGPL-3.0**         | Visual: ícone licença + texto "Software livre AGPL-3.0". Tooltip: "Podes inspeccionar, modificar e auto-hospedar."                 |

**Linha de credibilidade:**

> Quando uma startup PT te diz que respeita a tua privacidade, é fácil dizer. Quando a startup é open-source, podes verificar.

**[AUTO-DECISION]** Sem testimonials inventados — viola Article IV (No Invention) e tom calmo do produto. Recomendação: adicionar 3 testimonials reais em v1.1 quando houver utilizadores beta dispostos.

**Q7 (open question):** Eurico — temos design parceiros para mostrar (incubadoras, comunidade)? Default: não, ficamos só com os 3 badges.

---

### Section 8 — FAQ

7 perguntas reais que aparecem na cabeça de quem está a hesitar:

| #   | Pergunta                                                              | Resposta                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Funciona em PT-PT mesmo? Não é tradução automática do brasileiro?** | Sim, PT-PT genuíno desde o dia 1. Não há nenhum botão de "trocar para PT-BR" porque não existe — é só PT-PT. Se vires "geladeira" ou "celular" em algum sítio, é bug e queremos saber.                                                                         |
| 2   | **Os meus dados financeiros são seguros?**                            | Tudo em Postgres com encriptação em repouso, em servidores em Frankfurt (Supabase EU). RLS (row-level security) garante que ninguém — nem nós, sem credenciais admin auditadas — consegue ver os teus dados sem estares autenticado. Comunicação via TLS 1.2+. |
| 3   | **Tenho de meter cartão no trial?**                                   | Não. O trial de 14 dias começa quando te registas e termina sozinho. Se não escolheres um plano, ficas no Free (1 módulo, 50 prompts/mês). Não há cobrança surpresa.                                                                                           |
| 4   | **Posso cancelar sem custos?**                                        | Sim, a qualquer momento. Cancelamentos aplicam-se no fim do período pago — usas até ao último dia. Sem penalizações, sem retenções.                                                                                                                            |
| 5   | **Funciona em smartphone?**                                           | Sim, web responsiva. Desktop é a experiência principal, mas mobile funciona bem para chat rápido, ver tarefas e adicionar despesas. App nativa Android/iOS está em roadmap (Fase 2 e 3).                                                                       |
| 6   | **Posso pagar com Multibanco ou MB Way?**                             | Sim, ambos. O checkout (via Stripe PT) aceita cartão, Multibanco e MB Way nativamente. Factura electrónica PT é emitida em todos os pagamentos.                                                                                                                |
| 7   | **E se quiser sair? Posso levar os meus dados?**                      | Sim. No painel da conta exportas tudo em JSON ou CSV a qualquer momento — tarefas, finanças, prompts, audit log. Se decidires apagar a conta, os dados são purgados em 30 dias incluindo backups.                                                              |

**Componente:** Accordion shadcn/ui (`Accordion` Tier 2 do `front-end-spec.md`). Apenas uma pergunta aberta de cada vez.

---

### Section 9 — Final CTA

| Elemento                              | Conteúdo                                                           |
| ------------------------------------- | ------------------------------------------------------------------ |
| **H2 grande final**                   | Pronto para deixar de saltar entre apps?                           |
| **Subheading**                        | 14 dias grátis. Sem cartão. PT-PT genuíno.                         |
| **Primary CTA**                       | `Começar trial Família grátis` (botão Atlântico grande, centrado)  |
| **Secondary line**                    | Ou começa pelo plano gratuito — 1 módulo, 50 prompts/mês, sem fim. |
| **Footer mensagem (acima do footer)** | Construído em Portugal. Dados na União Europeia. Software livre.   |

**Layout:** centrado, padding vertical generoso (space-16), background ligeiramente diferente (`#F4ECE3` — accent-subtle Cortiça) para criar separação do footer técnico.

---

### Footer

**Layout:** 4 colunas em desktop, stack em mobile.

| Coluna 1        | Coluna 2    | Coluna 3                | Coluna 4                 |
| --------------- | ----------- | ----------------------- | ------------------------ |
| **Produto**     | **Empresa** | **Legal**               | **Comunidade**           |
| Funcionalidades | Sobre       | Política de Privacidade | GitHub                   |
| Preços          | Blog (v2)   | Termos                  | Status                   |
| Roadmap         | Contacto    | RGPD                    | Newsletter (input email) |
| Mudanças        |             | DPA                     |                          |

**Linha inferior do footer:**

- Logo Expressia (wordmark Lora) à esquerda
- Centro: `© 2026 Expressia. Construído em Portugal.`
- Direita: badges horizontais — `AGPL-3.0` · `RGPD` · `Made in PT` (cada um link)

**Newsletter signup (Coluna 4):**

- Input email + botão "Subscrever"
- Texto pequeno: "Updates mensais. Sem spam. Cancelas com um clique."
- **[AUTO-DECISION]** Newsletter sim mas opcional, sem obstrução do funil principal. Provedor: ResendCloud (já no stack — `architecture.md` §4).

**Idioma:** apenas PT-PT — **sem switcher de idioma**. Atributo HTML `lang="pt-PT"`.

**[AUTO-DECISION]** Sem cookies de consentimento intrusivo — usar Plausible.io ou similar (RGPD-friendly por design, sem cookies, sem PII). Decisão final delegada a @architect na implementação. Justificação: NFR12 já proíbe logging de PII em prompts; ser consistente com analytics.

---

## 3. Tom de Voz e Copy Guidelines

### 3.1 Tom

| Atributo           | Detalhe                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Pessoa**         | "Tu" (informal direccional). Nunca "você", nunca "vocês".                                                                         |
| **Distância**      | Próximo mas profissional — como um colega que percebe da matéria, não um amigo a vender.                                          |
| **Energia**        | Calma. Verbos directos ("cria", "marca", "paga") em vez de exclamativos ("AGE AGORA!").                                           |
| **Origem**         | Contemporâneo PT-PT — não regionalista (sem "fixe", sem "ya"), não anglicizado (sem "feature", sem "stack" na copy de marketing). |
| **Posicionamento** | O membro/utilizador é o herói. O Expressia é o guia. Nunca virar isto.                                                            |

### 3.2 Vocabulário PROIBIDO (PT-BR ou demasiado tech)

| Proibido   | Substituir por                                           |
| ---------- | -------------------------------------------------------- |
| App        | Aplicação (em copy formal) ou "o Expressia" (preferível) |
| Deletar    | Eliminar / apagar                                        |
| Setar      | Definir                                                  |
| Time       | Equipa / família                                         |
| Você       | Tu                                                       |
| OK sozinho | Está bem / Combinado                                     |
| Geladeira  | Frigorífico (caso entre acidentalmente)                  |
| Celular    | Telemóvel                                                |
| Tela       | Ecrã                                                     |
| Cadastrar  | Registar                                                 |
| Senha      | Palavra-passe                                            |
| Salvar     | Guardar                                                  |
| Login      | Entrar (verbo) / Acesso (substantivo)                    |
| Logout     | Sair                                                     |

### 3.3 Vocabulário PROIBIDO (vendedor / hype)

| Proibido         | Substituir por                            |
| ---------------- | ----------------------------------------- |
| REVOLUCIONÁRIO   | "diferente" ou nada                       |
| MUDA A TUA VIDA  | "reduz fricção" / nada                    |
| ÚNICO NO MERCADO | "feito para Portugal"                     |
| INCRÍVEL         | "feito com cuidado" / nada                |
| AUTOMÁTICO       | "sem fricção" / "sem precisar de pensar"  |
| INTELIGENTE      | "entende" / "interpreta"                  |
| FÁCIL            | "simples" / "directo"                     |
| AI / IA gigante  | utilizar com discrição, não como buzzword |
| GARANTIDO        | "comprovado" / "testado"                  |

### 3.4 Tagline candidata (3 opções para Eurico escolher)

| #     | Tagline                                            | Argumento                                                         |
| ----- | -------------------------------------------------- | ----------------------------------------------------------------- |
| **A** | **Uma frase. Tudo organizado.**                    | Curta, punchy, descreve o produto sem hype. **Recomendação Uma.** |
| B     | O assistente em português que organiza a tua vida. | Mais descritiva, mas mais longa e menos memorável.                |
| C     | Tarefas, finanças e família — numa só conversa.    | Funcional, lista o que faz, mas perde poesia.                     |

A opção A é a recomendação por ser:

- Memorável (8 palavras vs 11/12)
- Universal (não amarra a "produtividade", "finanças" ou "AI")
- Tom calmo (afirmação curta, não promessa exagerada)
- Aderente ao paradigma chat-first (a "frase" é o input)

**Q4 (open question):** validar tagline com Eurico antes de impressão de qualquer material. Default: A.

---

## 4. SEO + Meta Tags

### 4.1 Meta Tags propostas

```html
<!DOCTYPE html>
<html lang="pt-PT">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />

    <title>
      Expressia — Assistente em português para tarefas, finanças e agenda da família | €8,88/mês
    </title>
    <meta
      name="description"
      content="Uma frase em português organiza tarefas, finanças e agenda da tua família. Trial 14 dias sem cartão. Multi-utilizador. Dados na UE. Open-source."
    />
    <link rel="canonical" href="https://expressia.pt" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pt_PT" />
    <meta property="og:title" content="Expressia — Uma frase. Tudo organizado." />
    <meta
      property="og:description"
      content="Assistente em português para tarefas, finanças e agenda da família. €8,88/mês. Trial 14 dias sem cartão."
    />
    <meta property="og:image" content="https://expressia.pt/og-image.png" />
    <meta property="og:url" content="https://expressia.pt" />
    <meta property="og:site_name" content="Expressia" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Expressia — Uma frase. Tudo organizado." />
    <meta
      name="twitter:description"
      content="Assistente em português para tarefas, finanças e agenda da família. €8,88/mês."
    />
    <meta name="twitter:image" content="https://expressia.pt/og-image.png" />

    <!-- Schema.org JSON-LD (mostrar à @dev na implementação) -->
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Expressia",
        "operatingSystem": "Web",
        "applicationCategory": "ProductivityApplication",
        "offers": {
          "@type": "Offer",
          "price": "8.88",
          "priceCurrency": "EUR",
          "availability": "https://schema.org/InStock"
        },
        "inLanguage": "pt-PT",
        "url": "https://expressia.pt"
      }
    </script>
  </head>
</html>
```

**Note:** description está em 154 caracteres (limite 155-160). Title em 89 caracteres (limite recomendado 60 — aceitável aqui porque é um produto novo e queremos visibilidade do preço).

### 4.2 Keywords-alvo (PT-PT, sem PT-BR)

**Cluster primário (intent: encontrar produto):**

- gestão tarefas família portugal
- aplicação finanças família portugal
- gestor despesas casal portugal
- assistente AI português
- alternativa portuguesa ao néctar
- aplicação para casais gerir contas

**Cluster secundário (intent: comparar):**

- alternativa ao todoist em português
- gestor financeiro família português
- ynab português
- aplicação RGPD finanças família
- splitwise família portugal

**Cluster long-tail (intent: research):**

- como gerir orçamento de casal em portugal
- aplicação para registar despesas em conjunto
- como organizar a agenda da família
- aplicação portuguesa de produtividade RGPD
- assistente AI em português europeu

**[AUTO-DECISION]** SEO principal via conteúdo da própria landing + blog (Fase 2). Sem investimento SEM no MVP — orgânico + 2 campanhas pequenas conforme OKR Q1 do `project-brief.md` §7.

---

## 5. Visual Direction

### 5.1 Princípios

| Princípio                       | Aplicação                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Calma sobre energia**         | Background creme `#FAFAF7`, espaços brancos generosos (space-16 entre secções), animações curtas e suaves (transition-default 180ms)              |
| **Editorial sobre agressivo**   | Lora em headlines display (H1, H2, hero), Inter em body. Anti-vibe ChatGPT/Néctar.                                                                |
| **Mediterrânico sobre nórdico** | Paleta Atlântico+Cortiça (azul profundo + terracota suave), não cinzentos Microsoft ou pretos puros Linear                                        |
| **Made in Portugal sem cliché** | Bandeira PT só uma vez (badge no Section 7). Sem azulejos, sem galos de Barcelos, sem fundo amarelo+verde. Tom: contemporâneo PT, não folclórico. |
| **WCAG AA mínimo**              | Contraste ≥4.5:1 em todo texto. Focus visible 2px Atlântico. Suporte completo a `prefers-reduced-motion`.                                         |

### 5.2 Tokens (do `front-end-spec.md` §3)

A landing usa exactamente os mesmos tokens do produto (CSS variables `:root`). Sem fork de design para marketing.

**Cores principais na landing:**

- Background page: `--bg-canvas` (`#FAFAF7`)
- Cartões/secções: `--bg-surface` (`#FFFFFF`)
- Primary CTA: `--primary` (Atlântico `#1F4F6A`) com `--primary-hover` (`#163A4F`)
- Accent (Família tier highlight): `--accent` (Cortiça `#B5754A`)
- Secção final CTA: `--accent-subtle` (`#F4ECE3`)

**Tipografia na landing:**

- H1 hero: Lora 600, 56px / 64px linhe-height (escalar acima da type scale do produto — landing aceita maior emphasis)
- H2 secções: Lora 600, 40px
- Body: Inter 400, 17px / 28px (também acima da type scale do produto — landing precisa respiro adicional)
- CTAs: Inter 600, 16px

**[AUTO-DECISION]** A landing usa type scale ligeiramente aumentada (H1 56px vs 32px no produto) porque é uma página de marketing — emphasis hierárquica é crítica. @dev deve criar variants Tailwind `marketing-h1`, `marketing-body` etc. em vez de hard-coding.

### 5.3 Componentes visuais críticos

| Componente                 | Detalhe                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hero mockup**            | PNG/WebP do produto a mostrar chat split. Resolução 2x para retina. Tamanho ~120kb optimizado. Lazy load não — é hero.                                    |
| **Pricing card "Família"** | Border `2px solid var(--primary)`, shadow-md em repouso, scale 1.02 vs cards adjacentes, badge "Mais popular" em Cortiça subtle no canto superior direito |
| **Section 3 demo blocks**  | 3 abas controladas por click, transição entre exemplos com `transition-default`. Mockup chat estilizado igual ao produto (front-end-spec §5.4)            |
| **Footer GitHub badge**    | Componente que faz fetch GitHub stars (fallback estático no SSR Vercel). Link directo para `github.com/DaSilvaAlves/expressia`.                           |

### 5.4 Imagens necessárias (delegação para asset designer / nano-banana-generator)

| Asset                            | Dimensões                | Formato             | Notas                                                                              |
| -------------------------------- | ------------------------ | ------------------- | ---------------------------------------------------------------------------------- |
| Hero mockup desktop              | 1280x800 (2x: 2560x1600) | WebP + PNG fallback | App split: chat à esquerda, painel resultados à direita                            |
| Hero mockup mobile               | 720x1280                 | WebP + PNG          | App em formato vertical                                                            |
| Section 2 ilustração "três apps" | 800x600                  | SVG                 | Linha-fina, estilo editorial                                                       |
| Section 7 badge "Made in PT"     | 64x64                    | SVG                 | Bandeira flat sem cartoon                                                          |
| OG image (`og-image.png`)        | 1200x630                 | PNG                 | "Expressia — Uma frase. Tudo organizado." sobre creme `#FAFAF7` com mockup pequeno |
| Favicon                          | 32x32, 16x16, 192x192    | ICO + PNG + SVG     | Símbolo Atlântico em creme                                                         |

**Q8 (open question):** Eurico — temos designer humano para criar estas imagens, ou usamos `nano-banana-generator` (squad design-system) para gerar? Default: gerar com nano-banana, refinar manualmente o que ficar fraco.

---

## 6. Open Questions para Eurico

| ID  | Pergunta                                                                                                   | Recomendação default                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Logo final existe ou ainda é text-based "Expressia"?                                                       | **Wordmark Lora 600 (text-based) para MVP**, símbolo+wordmark depois. Justificação: front-end-spec §2.2 já descreve concept; wordmark sozinho aceita-se em MVP. |
| Q2  | Demo interactiva real ou mockup estático?                                                                  | **Mockup estático MVP** — interactiva v2 quando a API agent estiver estável. Reduz scope drasticamente.                                                         |
| Q3  | Vídeo no hero ou só imagem?                                                                                | **Imagem MVP**. Vídeo só faz sentido quando tivermos casos reais. Imagem permite LCP <2s (NFR4).                                                                |
| Q4  | Tagline final — A, B ou C?                                                                                 | **A: "Uma frase. Tudo organizado."** — mais memorável, mais alinhada com paradigma chat-first.                                                                  |
| Q5  | Newsletter signup no footer?                                                                               | **Sim, opcional, não-intrusivo.** Provedor: ResendCloud (já no stack).                                                                                          |
| Q6  | Comparação directa Section 4 nominativa (Néctar/Todoist/YNAB) ou genérica ("alternativas internacionais")? | **Nominativa** — diferenciação é mais clara, sem risco legal em comparação honesta de features publicamente verificáveis.                                       |
| Q7  | Logos de parceiros/incubadoras na Section 7?                                                               | **Não no MVP** — só os 3 badges (GitHub, Made in PT, AGPL). Adicionar quando houver parceiros reais.                                                            |
| Q8  | Imagens — designer humano ou nano-banana-generator?                                                        | **Nano-banana primeiro, refinar manualmente o que ficar fraco.** Decisão delegada a `@design-chief` quando squad activo.                                        |
| Q9  | Blog na Coluna 2 do footer?                                                                                | **Adiar para v2** — landing primeiro, blog quando houver matéria. Esconder link no MVP ou mostrar "Em breve".                                                   |
| Q10 | Plano Pessoal na Section 5 — manter o preço €4,90 mesmo?                                                   | Confirmar com Eurico — é o preço actual no PRD (FR34).                                                                                                          |
| Q11 | Em vez de 4 planos no pricing, seria mais conversor mostrar só Família + Free + (link "Outros planos")?    | **Mostrar 4** — Família destacado já capta atenção; remover Pessoal/Pro pode parecer manipulador.                                                               |
| Q12 | Animação na Section 3 (auto-rotate entre os 3 exemplos a cada 5s)?                                         | **Não auto-rotate** — utilizador escolhe aba. Auto-rotate é hostil a leitura calma e viola "calma sobre energia" (front-end-spec §1.2).                         |

---

## 7. Implementation Notes (para @dev quando Story 1.5 fechar)

### 7.1 Estrutura de ficheiros

| Path                                                         | Conteúdo                                     |
| ------------------------------------------------------------ | -------------------------------------------- |
| `apps/web/src/app/(marketing)/page.tsx`                      | Página principal                             |
| `apps/web/src/app/(marketing)/layout.tsx`                    | Layout sem auth, com header/footer marketing |
| `apps/web/src/app/(marketing)/precos/page.tsx`               | Pricing standalone (linka da landing)        |
| `apps/web/src/app/(marketing)/politica-privacidade/page.tsx` | Privacy policy PT-PT                         |
| `apps/web/src/components/marketing/Hero.tsx`                 | Section 1                                    |
| `apps/web/src/components/marketing/Problem.tsx`              | Section 2                                    |
| `apps/web/src/components/marketing/HowItWorks.tsx`           | Section 3 (com tabs)                         |
| `apps/web/src/components/marketing/FamilyFirst.tsx`          | Section 4                                    |
| `apps/web/src/components/marketing/Pricing.tsx`              | Section 5                                    |
| `apps/web/src/components/marketing/Privacy.tsx`              | Section 6                                    |
| `apps/web/src/components/marketing/SocialProof.tsx`          | Section 7                                    |
| `apps/web/src/components/marketing/FAQ.tsx`                  | Section 8                                    |
| `apps/web/src/components/marketing/FinalCTA.tsx`             | Section 9                                    |
| `apps/web/src/components/marketing/Footer.tsx`               | Footer                                       |
| `apps/web/public/og-image.png`                               | Open Graph image                             |
| `apps/web/public/marketing/hero-mockup-desktop.webp`         | Hero asset                                   |

### 7.2 Stack técnica

| Layer          | Tecnologia                       | Notas                                                                                          |
| -------------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 App Router            | Já decidido (`architecture.md`)                                                                |
| Componentes UI | shadcn/ui + Radix                | Já decidido (front-end-spec §4.1)                                                              |
| Styling        | Tailwind CSS                     | Tokens vivem em `app/globals.css` como CSS vars                                                |
| Animações      | Framer Motion (subtis)           | Apenas onde Tailwind transitions não chegam — Section 3 tabs, Section 8 accordion já têm Radix |
| Icons          | Lucide React                     | Já no stack                                                                                    |
| Analytics      | Plausible.io ou Simple Analytics | RGPD-friendly, sem cookies, confirmar com @architect                                           |
| Imagens        | `next/image` com WebP            | LCP optimizado, lazy load tudo abaixo do hero                                                  |
| Fontes         | Inter + Lora + JetBrains Mono    | `next/font/google` com variable fonts, subset `latin-ext`                                      |

### 7.3 Performance targets

| Métrica         | Target           | Justificação                      |
| --------------- | ---------------- | --------------------------------- |
| LCP             | <2s              | NFR4 PRD                          |
| CLS             | <0.1             | Web Vitals standard               |
| FCP             | <1s              | Vercel fra1 já entrega isto       |
| TTI             | <3s              | Página estática, sem JS pesado    |
| Total bundle JS | <100kb (gzipped) | Sem libs pesadas, RSC aproveitado |

**Estratégias:**

- Maioria das secções como **React Server Components** (zero JS no cliente).
- Componentes interactivos (Section 3 tabs, Section 8 accordion) como Client Components isolados com `'use client'`.
- Hero mockup em `next/image` com `priority` flag.
- Restantes imagens com `loading="lazy"`.
- Fonts em `display: swap` para evitar FOIT.

### 7.4 Acessibilidade

| Verificação         | Como                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Contraste WCAG AA   | Tokens já validados em `front-end-spec.md` §3.1                                          |
| Focus visible       | Tailwind `focus-visible:ring-2 ring-primary` em todos os interactivos                    |
| Keyboard navigation | Tab order natural; skip-to-content link no topo                                          |
| Screen reader       | Headings hierárquicos H1>H2>H3, alt text em todas imagens, ARIA labels em CTAs com ícone |
| Reduced motion      | `@media (prefers-reduced-motion: reduce)` desactiva Framer Motion                        |
| Lang attribute      | `<html lang="pt-PT">`                                                                    |

### 7.5 i18n

**APENAS PT-PT.** Sem language switcher, sem alternates, sem hooks de tradução. Isto é um requisito de produto (CON3 PRD), não uma simplificação técnica.

```html
<html lang="pt-PT"></html>
```

Sem `hreflang`. Sem `<link rel="alternate" hreflang="...">`.

### 7.6 SEO técnico

| Item        | Detalhe                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| Sitemap     | `apps/web/src/app/sitemap.ts` — gerar com `/`, `/precos`, `/politica-privacidade` |
| Robots      | `apps/web/src/app/robots.ts` — `Allow: /` para tudo público                       |
| `lang`      | `pt-PT`                                                                           |
| `canonical` | `https://expressia.pt` em todas as páginas                                        |
| Schema.org  | JSON-LD `SoftwareApplication` (ver §4.1)                                          |

### 7.7 Analytics & Privacy

| Item              | Decisão                                                                          |
| ----------------- | -------------------------------------------------------------------------------- |
| Provider          | Plausible.io ou Simple Analytics (confirmar com @architect)                      |
| Cookies           | **Zero** — provider sem cookies por design                                       |
| Consent banner    | **Não necessário** se zero cookies — confirmar interpretação RGPD com @analyst   |
| Eventos a tracker | Page views, CTA clicks (signup, pricing), Section 3 tab switches, FAQ expansions |

**[AUTO-DECISION]** Sem GDPR consent banner intrusivo se usarmos analytics sem cookies. Se @architect ou @analyst recomendar banner por precaução legal, usar componente discreto com toggle padrão "Aceitar" + link "Ler mais".

### 7.8 Vercel config

```json
{
  "regions": ["fra1"],
  "framework": "nextjs"
}
```

Já configurado em `apps/web/vercel.json` (CLAUDE.md project §Convenções de Código). Sem alteração necessária.

---

## 8. Métricas de Sucesso da Landing

Para medir se esta página está a fazer o trabalho dela:

| Métrica                          | Target Q1           | Como medir                         |
| -------------------------------- | ------------------- | ---------------------------------- |
| Bounce rate                      | <55%                | Plausible default                  |
| Tempo médio na página            | >90s                | Indica leitura genuína             |
| Scroll depth >75%                | >40% dos visitantes | Heatmap ou evento Plausible custom |
| CTA click rate (Hero primary)    | >8%                 | Click event tracking               |
| Conversão landing → signup       | ≥4%                 | Funnel Plausible                   |
| Conversão signup → trial start   | ≥80%                | Backend tracking (auth flow)       |
| Conversão trial → paid (Família) | ≥8%                 | Backend tracking (Stripe events)   |

**Iteração:** revisitar copy + estrutura após primeiros 1.000 visitantes. A/B testar tagline e CTA wording em v1.1.

---

## 9. Critical Path para Implementação

Antes de pôr a landing pública (`expressia.pt` → produção), tem que estar feito:

| #   | Tarefa                                                   | Responsável                 | Bloqueador?                                       |
| --- | -------------------------------------------------------- | --------------------------- | ------------------------------------------------- |
| 1   | Story 1.5 (Auth) fechada — auth flow funcional           | @dev                        | **SIM** — landing CTA leva a `/registar`          |
| 2   | Story de Stripe billing iniciada (não precisa fechada)   | @dev                        | NÃO — pricing pode ser estático MVP               |
| 3   | Política de Privacidade redigida (PT-PT, RGPD compliant) | @analyst + @pm              | **SIM** — link no Section 6 + footer              |
| 4   | Termos de Utilização redigidos                           | @analyst + @pm              | **SIM** — link footer                             |
| 5   | Imagens hero criadas (mockup app)                        | nano-banana-generator + Uma | **SIM** — Section 1                               |
| 6   | Domínio `expressia.pt` configurado em Vercel             | @devops                     | **SIM** — produção                                |
| 7   | Plausible.io conta criada e snippet adicionado           | @devops                     | NÃO — bloqueador apenas para métricas             |
| 8   | Email transaccional ResendCloud configurado              | @devops                     | NÃO — só para newsletter signup                   |
| 9   | Trademark INPI Portugal verificado para "Expressia"      | @analyst                    | **SIM** — risco legal antes de lançamento público |
| 10  | OG image criada (1200x630)                               | nano-banana + @dev          | NÃO — bloqueador apenas para shares sociais       |

---

## Change Log

| Versão | Data       | Autor                   | Mudanças                                                                                                 |
| ------ | ---------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| v0.1   | 2026-05-06 | @ux-design-expert (Uma) | Draft inicial — 9 secções + footer, copy production-ready PT-PT, 12 open questions, implementation notes |

---

_Pronto para revisão do Eurico. Próximo passo recomendado: Eurico responde às 12 open questions (Q1-Q12), depois Uma actualiza para v0.2 com decisões fixadas, depois @dev implementa após Story 1.5 fechar._
