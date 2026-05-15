/**
 * Fixtures curados de 200 prompts PT-PT (mercado Portugal exclusivo — CON4 / NFR
 * PT-PT exclusivo).
 *
 * Trace: Story 2.10 AC4 + PRD OKR O2 KR2 ("precisão ≥90% em classificação de
 *        intents num conjunto de 200 prompts PT-PT") + Architecture §4.2.
 *
 * Distribuição (auditada — soma = 200):
 *
 *   criar_tarefa:              40
 *   criar_financa_variavel:    40
 *   criar_financa_recorrente:  20
 *   criar_parcelada:           15
 *   criar_cartao:              10
 *   consultar_dados:           30
 *   cancelar_ultima:           10
 *   multi-intent (≥2 intents): 25
 *   unknown (out-of-scope):    10
 *                              ─────
 *                              200
 *
 * Princípios:
 *   - Apenas PT-PT (sem PT-BR). Vocabulário verificado contra
 *     `~/.claude/rules/language-standards.md` (e.g., "utilizar" não "usar";
 *     "eliminar" não "deletar"; "frigorífico" não "geladeira"; "automóvel/
 *     carro" não "auto"; "verificar" não "checar").
 *   - Zero PII real. Nomes ficcionais ("João Silva", "Maria Costa", "Ana Santos",
 *     "Pedro Almeida"). NIFs sempre `999999990` (Finanças reconhece como dummy).
 *     IBANs começam por `PT50` seguidos de 21 dígitos `0`.
 *   - Quantidades em EUR com separador decimal vírgula ou ponto (representação
 *     PT-PT — humanos escrevem ambos).
 *   - Diversidade lexical: imperativo, declarativo, abreviado, formal.
 *
 * QA4 (PO decision): @dev gera draft → @po revê amostragem 30 → Eurico
 * approves antes de push. Esta lista vira fixture canónica versionada.
 *
 * NFR12 (zero PII em terceiros) — confirma-se na test
 * `benchmark-fixtures.test.ts` AC11(iii) via regex NIF/IBAN/email.
 */
import type { Intent } from '@meu-jarvis/classifier';

/**
 * Fixture individual de benchmark. Cada prompt mapeia para uma ou mais intents
 * esperadas + confiança mínima esperada + notas para revisão humana (@po + Eurico).
 */
export interface BenchmarkFixture {
  readonly id: number;
  /** Prompt PT-PT — sem PII real (dados ficcionais ou genéricos). */
  readonly prompt: string;
  /** Intents esperadas. Multi-intent → array com >1 elemento. */
  readonly expected_intents: readonly Intent[];
  /**
   * Confiança mínima esperada (0-1). Prompts ambíguos podem ter <0.70 para
   * validar preview-then-confirm flow (FR4). Inequação inclusiva: actual ≥ min.
   */
  readonly expected_confidence_min: number;
  /** Nota PT-PT para revisão humana (@po amostragem 30 + Eurico approve). */
  readonly notes: string;
}

// =============================================================================
// FIXTURES — 200 prompts curados
// =============================================================================

/**
 * Helper interno para construir fixtures de forma compacta com ID auto-gerado.
 *
 * NOTA: garante IDs sequenciais 1-200 — qualquer reordenação manual deve
 * preservar a contagem (verificado em `benchmark-fixtures.test.ts`).
 */
const fx = (
  prompt: string,
  intents: readonly Intent[],
  expected_confidence_min: number,
  notes: string,
): Omit<BenchmarkFixture, 'id'> => ({
  prompt,
  expected_intents: intents,
  expected_confidence_min,
  notes,
});

const fixturesUnsorted: readonly Omit<BenchmarkFixture, 'id'>[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // criar_tarefa × 40 (1-40)
  // ──────────────────────────────────────────────────────────────────────────
  fx('lembra-me de pagar a renda na próxima sexta', ['criar_tarefa'], 0.85, 'tarefa com prazo relativo — comum'),
  fx('adiciona tarefa comprar pão amanhã de manhã', ['criar_tarefa'], 0.9, 'tarefa simples curta — alta confiança'),
  fx('quero apontar reunião com a Maria às 14h de quinta', ['criar_tarefa'], 0.85, 'tarefa com pessoa + hora'),
  fx('preciso de marcar consulta no dentista para a próxima semana', ['criar_tarefa'], 0.8, 'tarefa com prazo difuso'),
  fx('cria uma tarefa: levar o gato ao veterinário no sábado', ['criar_tarefa'], 0.9, 'comando explícito — alta confiança'),
  fx('apontamento: chamar o canalizador hoje à tarde', ['criar_tarefa'], 0.85, 'forma substantiva PT-PT'),
  fx('agenda enviar relatório ao chefe segunda-feira de manhã', ['criar_tarefa'], 0.85, 'tarefa profissional'),
  fx('não te esqueças de levantar o medicamento na farmácia amanhã', ['criar_tarefa'], 0.8, 'imperativo informal família'),
  fx('regista que tenho de comprar cartões de aniversário', ['criar_tarefa'], 0.85, 'tarefa sem prazo'),
  fx('mete na lista: pagar a conta da água até dia 20', ['criar_tarefa'], 0.85, 'tarefa com prazo absoluto'),
  fx('lembra-me de ligar à minha mãe amanhã', ['criar_tarefa'], 0.85, 'tarefa pessoal família'),
  fx('preciso ir buscar a roupa à tinturaria na quinta', ['criar_tarefa'], 0.8, 'tarefa com local implícito'),
  fx('adiciona à minha to-do: passar a aspirar a sala sábado de manhã', ['criar_tarefa'], 0.85, 'tarefa doméstica'),
  fx('quero criar uma tarefa para revisar o automóvel até ao fim do mês', ['criar_tarefa'], 0.85, 'tarefa veículo — PT-PT "automóvel"'),
  fx('marca: entregar projecto à escola na próxima quarta-feira', ['criar_tarefa'], 0.85, 'tarefa escolar filho'),
  fx('preciso de comprar prendas de Natal este fim-de-semana', ['criar_tarefa'], 0.8, 'tarefa sazonal'),
  fx('lembra-me amanhã de tirar o lixo antes das 8h', ['criar_tarefa'], 0.85, 'tarefa rotineira matinal'),
  fx('agenda regar as plantas terça e sábado', ['criar_tarefa'], 0.8, 'tarefa recorrente implícita — pode ir para criar_tarefa simples sem recorrência'),
  fx('regista tarefa: enviar email à Ana Santos com a factura', ['criar_tarefa'], 0.85, 'tarefa profissional com pessoa'),
  fx('mete no calendário ir ao supermercado domingo de manhã', ['criar_tarefa'], 0.8, 'tarefa fim-de-semana'),
  fx('preciso de marcar IPO do carro até dia 30', ['criar_tarefa'], 0.85, 'tarefa veículo PT-PT (IPO = inspecção)'),
  fx('apontar: levantar dinheiro no multibanco hoje', ['criar_tarefa'], 0.8, 'tarefa financeira não-transacção'),
  fx('lembra-me de comprar leite e pão quando passar no Pingo Doce', ['criar_tarefa'], 0.85, 'tarefa compras genérica — NÃO criar_financa_variavel porque não regista despesa'),
  fx('agenda chamar a Segurança Social na segunda das 9h às 12h', ['criar_tarefa'], 0.85, 'tarefa burocrática'),
  fx('adiciona: levar o lixo reciclável ao ecoponto amanhã', ['criar_tarefa'], 0.85, 'tarefa doméstica PT-PT (ecoponto)'),
  fx('quero apontar: reunião pais e professores dia 25 às 18h', ['criar_tarefa'], 0.85, 'tarefa escolar com data'),
  fx('preciso de ligar à minha avó este fim-de-semana', ['criar_tarefa'], 0.8, 'tarefa família sem prazo exacto'),
  fx('marca-me consulta no hospital para revisão geral', ['criar_tarefa'], 0.75, 'tarefa saúde — pode ser ambígua (sugestão vs comando)'),
  fx('regista que preciso de renovar a carta de condução até Outubro', ['criar_tarefa'], 0.85, 'tarefa burocrática PT-PT'),
  fx('mete na lista comprar tinta para pintar a sala', ['criar_tarefa'], 0.85, 'tarefa doméstica/compras'),
  fx('lembra-me de levar os livros à biblioteca terça', ['criar_tarefa'], 0.85, 'tarefa devolução'),
  fx('cria tarefa: tratar do registo automóvel no IMT', ['criar_tarefa'], 0.85, 'tarefa burocrática veículo'),
  fx('agenda comprar bilhetes para o concerto no sábado à noite', ['criar_tarefa'], 0.8, 'tarefa lazer'),
  fx('preciso de marcar reunião com o contabilista até quarta', ['criar_tarefa'], 0.85, 'tarefa profissional'),
  fx('apontamento: limpar o frigorífico antes do fim-de-semana', ['criar_tarefa'], 0.85, 'tarefa doméstica PT-PT (frigorífico)'),
  fx('lembra-me amanhã: enviar carta registada aos Finanças', ['criar_tarefa'], 0.85, 'tarefa burocrática'),
  fx('mete na to-do regar a horta segunda-feira de manhã', ['criar_tarefa'], 0.85, 'tarefa doméstica'),
  fx('preciso de marcar massagem terapêutica para a próxima quinta', ['criar_tarefa'], 0.85, 'tarefa pessoal saúde'),
  fx('regista tarefa: passar a noite no quarto da minha filha', ['criar_tarefa'], 0.65, 'tarefa família — confiança baixa por ambiguidade (FR4 preview)'),
  fx('adiciona: preparar bolo aniversário do Pedro até sábado', ['criar_tarefa'], 0.85, 'tarefa familiar com prazo'),

  // ──────────────────────────────────────────────────────────────────────────
  // criar_financa_variavel × 40 (41-80) — gastos pontuais
  // ──────────────────────────────────────────────────────────────────────────
  fx('gastei 35 euros no Pingo Doce hoje', ['criar_financa_variavel'], 0.9, 'gasto pontual supermercado'),
  fx('paguei 12,50 € no almoço no restaurante chinês', ['criar_financa_variavel'], 0.9, 'gasto pontual restauração'),
  fx('comprei livros por 47 euros na Bertrand', ['criar_financa_variavel'], 0.9, 'gasto cultura'),
  fx('gastei 80 € no abastecimento da viatura ontem', ['criar_financa_variavel'], 0.9, 'gasto combustível PT-PT'),
  fx('paguei 5,40 ao taxista que me levou à estação', ['criar_financa_variavel'], 0.85, 'gasto transporte'),
  fx('gastei 22 euros em flores para a minha mulher', ['criar_financa_variavel'], 0.9, 'gasto pessoal'),
  fx('despendi 150€ na consulta do dentista hoje', ['criar_financa_variavel'], 0.85, 'gasto saúde — PT-PT "despendi"'),
  fx('paguei 9,90 no parquímetro esta tarde', ['criar_financa_variavel'], 0.85, 'gasto transporte PT-PT'),
  fx('gastei 18,75 no almoço do escritório', ['criar_financa_variavel'], 0.9, 'gasto trabalho'),
  fx('comprei roupa por 95€ no Continente', ['criar_financa_variavel'], 0.9, 'gasto vestuário'),
  fx('paguei 30 euros pela revisão da bicicleta', ['criar_financa_variavel'], 0.85, 'gasto manutenção'),
  fx('gastei 11,50 no cinema ontem à noite', ['criar_financa_variavel'], 0.9, 'gasto lazer'),
  fx('paguei 65 euros no jantar de aniversário', ['criar_financa_variavel'], 0.9, 'gasto família'),
  fx('comprei material escolar por 28€ para a Maria', ['criar_financa_variavel'], 0.9, 'gasto família'),
  fx('gastei 4,20 num café e bolo no Starbucks', ['criar_financa_variavel'], 0.85, 'gasto pequeno cafetaria'),
  fx('paguei 75 euros na consulta de psicologia desta semana', ['criar_financa_variavel'], 0.85, 'gasto saúde mental'),
  fx('despesa de 14€ no supermercado para o pequeno-almoço', ['criar_financa_variavel'], 0.85, 'gasto alimentação PT-PT (pequeno-almoço)'),
  fx('gastei 200 euros num corte de cabelo e tratamento', ['criar_financa_variavel'], 0.85, 'gasto beleza'),
  fx('paguei 8,50 no carregamento do telemóvel pré-pago', ['criar_financa_variavel'], 0.85, 'gasto telecomunicações PT-PT (telemóvel)'),
  fx('comprei pão e leite na padaria por 6,30', ['criar_financa_variavel'], 0.9, 'gasto alimentação'),
  fx('gastei 45 € numa peça no FNAC para o computador', ['criar_financa_variavel'], 0.85, 'gasto tecnologia'),
  fx('paguei o estacionamento — 2,80 euros', ['criar_financa_variavel'], 0.85, 'gasto transporte'),
  fx('comprei medicamentos por 19,40 na farmácia', ['criar_financa_variavel'], 0.9, 'gasto saúde'),
  fx('jantei fora ontem — 38 euros', ['criar_financa_variavel'], 0.85, 'gasto restauração'),
  fx('paguei 110 € ao mecânico para mudar o óleo', ['criar_financa_variavel'], 0.85, 'gasto veículo'),
  fx('despesa de 7€ em pastéis de nata na Confeitaria Nacional', ['criar_financa_variavel'], 0.9, 'gasto típico PT — confeitaria'),
  fx('gastei 25 euros no caixa do hipermercado', ['criar_financa_variavel'], 0.85, 'gasto supermercado'),
  fx('paguei 15 euros na lavagem do carro', ['criar_financa_variavel'], 0.85, 'gasto veículo'),
  fx('comprei meias e roupa interior por 18€ na Tezenis', ['criar_financa_variavel'], 0.9, 'gasto vestuário'),
  fx('gastei 50 € num presente para os meus pais', ['criar_financa_variavel'], 0.85, 'gasto família'),
  fx('paguei 9 euros no autocarro mensal aos meus filhos', ['criar_financa_variavel'], 0.75, 'gasto pontual transporte filhos — confiança media (pode ser confundido com recorrente)'),
  fx('despesa 22,50 num corte de cabelo na barbearia', ['criar_financa_variavel'], 0.85, 'gasto beleza'),
  fx('paguei 65 € na renovação do passaporte', ['criar_financa_variavel'], 0.85, 'gasto burocrático'),
  fx('comprei vinho do Porto por 28 euros', ['criar_financa_variavel'], 0.9, 'gasto bebidas — PT cultura'),
  fx('paguei 7,50 nas portagens da A1', ['criar_financa_variavel'], 0.85, 'gasto autoestrada PT'),
  fx('gastei 120 euros em ténis Nike no centro comercial', ['criar_financa_variavel'], 0.9, 'gasto calçado'),
  fx('paguei 14,90 numa pizza para levar', ['criar_financa_variavel'], 0.9, 'gasto restauração takeaway'),
  fx('comprei móvel pequeno por 89€ no IKEA', ['criar_financa_variavel'], 0.85, 'gasto decoração'),
  fx('despesa 6,50 num gelado nas Caldas da Rainha', ['criar_financa_variavel'], 0.9, 'gasto lazer região PT'),
  fx('paguei 95 € ao electricista que veio cá', ['criar_financa_variavel'], 0.85, 'gasto serviço doméstico'),

  // ──────────────────────────────────────────────────────────────────────────
  // criar_financa_recorrente × 20 (81-100) — despesas mensais/periódicas
  // ──────────────────────────────────────────────────────────────────────────
  fx('internet 30 euros por mês com a Vodafone', ['criar_financa_recorrente'], 0.9, 'recorrente telecomunicações PT'),
  fx('renda da casa: 750 euros todos os meses no dia 1', ['criar_financa_recorrente'], 0.9, 'recorrente habitação'),
  fx('Netflix 13,99 mensalmente', ['criar_financa_recorrente'], 0.9, 'recorrente streaming'),
  fx('ginásio 35 € por mês', ['criar_financa_recorrente'], 0.9, 'recorrente lazer'),
  fx('luz cerca de 50 euros por mês com a EDP', ['criar_financa_recorrente'], 0.85, 'recorrente energia'),
  fx('seguro do carro 45 euros mensais com a Tranquilidade', ['criar_financa_recorrente'], 0.9, 'recorrente seguro auto'),
  fx('mensalidade da escola da Maria — 280 euros', ['criar_financa_recorrente'], 0.9, 'recorrente educação'),
  fx('regista despesa mensal: água 22€ todos os meses', ['criar_financa_recorrente'], 0.9, 'recorrente serviços públicos'),
  fx('subscrição Spotify Família 19,90 por mês', ['criar_financa_recorrente'], 0.9, 'recorrente streaming família'),
  fx('telemóvel da MEO 25 euros mensais', ['criar_financa_recorrente'], 0.9, 'recorrente telecomunicações'),
  fx('seguro de saúde Multicare 80 € por mês', ['criar_financa_recorrente'], 0.9, 'recorrente saúde'),
  fx('ATL dos miúdos: 120 euros por mês', ['criar_financa_recorrente'], 0.85, 'recorrente actividades pós-escola PT'),
  fx('gás natural 18€ mensal com a Galp', ['criar_financa_recorrente'], 0.85, 'recorrente energia'),
  fx('subscrição NOS TV — 45 euros todos os meses', ['criar_financa_recorrente'], 0.9, 'recorrente telecomunicações'),
  fx('condomínio 65 € por mês', ['criar_financa_recorrente'], 0.9, 'recorrente habitação'),
  fx('IMI da casa pagamento mensal 35 euros', ['criar_financa_recorrente'], 0.85, 'recorrente imposto PT'),
  fx('mensalidade da Catraio (creche) 380€', ['criar_financa_recorrente'], 0.85, 'recorrente creche'),
  fx('aulas de música da minha filha 60 euros por mês', ['criar_financa_recorrente'], 0.85, 'recorrente educação extra'),
  fx('regista: TV Cabo NOWO 28€ mensais', ['criar_financa_recorrente'], 0.85, 'recorrente media PT'),
  fx('LinkedIn Premium 25 euros por mês', ['criar_financa_recorrente'], 0.9, 'recorrente subscrição profissional'),

  // ──────────────────────────────────────────────────────────────────────────
  // criar_parcelada × 15 (101-115) — compras em prestações
  // ──────────────────────────────────────────────────────────────────────────
  fx('comprei TV 800 euros em 12 prestações no Worten', ['criar_parcelada'], 0.9, 'parcelada com loja PT'),
  fx('apontei a máquina de lavar 600€ em 6 prestações no Continente', ['criar_parcelada'], 0.9, 'parcelada electrodoméstico'),
  fx('telemóvel novo 1200 euros em 24 mensalidades', ['criar_parcelada'], 0.85, 'parcelada tecnologia'),
  fx('frigorífico 950 € em 10 prestações na Radio Popular', ['criar_parcelada'], 0.9, 'parcelada electrodoméstico'),
  fx('computador portátil 1500 euros em 18 prestações sem juros', ['criar_parcelada'], 0.9, 'parcelada tecnologia'),
  fx('mobília do quarto 2400 € pago em 24 vezes no Conforama', ['criar_parcelada'], 0.9, 'parcelada mobiliário'),
  fx('comprei o carro usado 8000 euros em 36 prestações', ['criar_parcelada'], 0.85, 'parcelada veículo'),
  fx('máquina de café 450 € em 6 mensalidades sem juros', ['criar_parcelada'], 0.9, 'parcelada electrodoméstico'),
  fx('bicicleta nova 850 euros em 12 prestações na Decathlon', ['criar_parcelada'], 0.9, 'parcelada lazer'),
  fx('cama nova de casal 600€ em 6 vezes no IKEA', ['criar_parcelada'], 0.9, 'parcelada mobiliário'),
  fx('lava-loiça novo 380 euros pago em 4 prestações', ['criar_parcelada'], 0.85, 'parcelada electrodoméstico'),
  fx('PlayStation 5 com jogos 700 € em 12 mensalidades', ['criar_parcelada'], 0.9, 'parcelada lazer/electronica'),
  fx('mota nova 4500 euros em 36 prestações na Honda', ['criar_parcelada'], 0.85, 'parcelada veículo'),
  fx('férias na Madeira 1800€ em 6 prestações via Halcon', ['criar_parcelada'], 0.85, 'parcelada viagens'),
  fx('óculos graduados 380 euros em 4 prestações na Multiópticas', ['criar_parcelada'], 0.85, 'parcelada saúde'),

  // ──────────────────────────────────────────────────────────────────────────
  // criar_cartao × 10 (116-125)
  // ──────────────────────────────────────────────────────────────────────────
  fx('adiciona o meu cartão Caixa com limite 2000 euros', ['criar_cartao'], 0.9, 'cartão CGD'),
  fx('regista cartão BPI Visa Classic limite 1500 €', ['criar_cartao'], 0.9, 'cartão BPI'),
  fx('mete cartão Activobank débito sem limite', ['criar_cartao'], 0.85, 'cartão Activobank'),
  fx('cartão Millennium Gold com plafond 5000€', ['criar_cartao'], 0.9, 'cartão Millennium PT'),
  fx('adiciona cartão crédito Santander limite 3000 euros', ['criar_cartao'], 0.9, 'cartão Santander Totta'),
  fx('regista cartão Crédito Agrícola débito', ['criar_cartao'], 0.85, 'cartão CA'),
  fx('cria cartão WIZINK com limite de 1000', ['criar_cartao'], 0.85, 'cartão WIZINK'),
  fx('cartão Revolut Premium adicionar à conta', ['criar_cartao'], 0.85, 'cartão Revolut'),
  fx('adiciona cartão Continente Universo limite 800€', ['criar_cartao'], 0.85, 'cartão branded PT'),
  fx('cria-me um cartão Worten Cards plafond 1500', ['criar_cartao'], 0.85, 'cartão branded retalho'),

  // ──────────────────────────────────────────────────────────────────────────
  // consultar_dados × 30 (126-155)
  // ──────────────────────────────────────────────────────────────────────────
  fx('quantas tarefas tenho para esta semana', ['consultar_dados'], 0.95, 'consulta tarefas count'),
  fx('mostra-me as despesas deste mês', ['consultar_dados'], 0.9, 'consulta finanças'),
  fx('quanto gastei em supermercado em Outubro', ['consultar_dados'], 0.9, 'consulta categórica + período'),
  fx('quais as tarefas em atraso', ['consultar_dados'], 0.95, 'consulta tarefas overdue'),
  fx('balanço deste mês', ['consultar_dados'], 0.9, 'consulta finanças resumo'),
  fx('listar todas as despesas variáveis de Novembro', ['consultar_dados'], 0.9, 'consulta finanças filtrada'),
  fx('quanto tenho de pagar este mês em recorrentes', ['consultar_dados'], 0.9, 'consulta finanças recorrentes'),
  fx('mostra-me os cartões registados', ['consultar_dados'], 0.9, 'consulta cartões'),
  fx('quais as prestações em curso', ['consultar_dados'], 0.9, 'consulta parceladas'),
  fx('total gasto este ano até agora', ['consultar_dados'], 0.9, 'consulta finanças anual'),
  fx('quanto sobrou do orçamento de Outubro', ['consultar_dados'], 0.85, 'consulta orçamento'),
  fx('lista as tarefas concluídas a semana passada', ['consultar_dados'], 0.9, 'consulta tarefas completas'),
  fx('quais as próximas mensalidades a vencer', ['consultar_dados'], 0.9, 'consulta recorrentes próximas'),
  fx('quanto gastei em combustível este mês', ['consultar_dados'], 0.9, 'consulta categoria específica'),
  fx('quantas prestações faltam para terminar a TV', ['consultar_dados'], 0.85, 'consulta parcelada específica'),
  fx('mostra-me as tarefas para hoje', ['consultar_dados'], 0.95, 'consulta tarefas hoje'),
  fx('quais despesas tive no Pingo Doce', ['consultar_dados'], 0.85, 'consulta filtrada por descrição'),
  fx('mostra histórico de despesas dos últimos 7 dias', ['consultar_dados'], 0.9, 'consulta histórica'),
  fx('quanto tenho disponível no cartão Caixa', ['consultar_dados'], 0.85, 'consulta cartão saldo'),
  fx('total das despesas com filhos este mês', ['consultar_dados'], 0.85, 'consulta categórica família'),
  fx('lista tarefas atribuídas à Maria', ['consultar_dados'], 0.85, 'consulta tarefas por utilizador'),
  fx('balanço da família este trimestre', ['consultar_dados'], 0.85, 'consulta agregada household'),
  fx('quanto poupei este mês', ['consultar_dados'], 0.85, 'consulta poupança implícita'),
  fx('mostra as despesas variáveis maiores que 100€', ['consultar_dados'], 0.85, 'consulta filtrada valor'),
  fx('quantos cartões tenho cadastrados', ['consultar_dados'], 0.9, 'consulta cartões count'),
  fx('lista despesas pendentes de pagamento', ['consultar_dados'], 0.85, 'consulta pendências'),
  fx('mostra-me um resumo financeiro do ano', ['consultar_dados'], 0.85, 'consulta sumário anual'),
  fx('quais tarefas têm a etiqueta urgente', ['consultar_dados'], 0.85, 'consulta tarefas filtro tag'),
  fx('quanto gastei no total em saúde este ano', ['consultar_dados'], 0.85, 'consulta categórica anual'),
  fx('mostra as três maiores despesas deste mês', ['consultar_dados'], 0.85, 'consulta top-N'),

  // ──────────────────────────────────────────────────────────────────────────
  // cancelar_ultima × 10 (156-165)
  // ──────────────────────────────────────────────────────────────────────────
  fx('anula a última coisa que fiz', ['cancelar_ultima'], 0.95, 'undo claro'),
  fx('cancela', ['cancelar_ultima'], 0.95, 'comando minimal'),
  fx('desfaz o último registo', ['cancelar_ultima'], 0.95, 'undo explícito'),
  fx('apaga a despesa que acabei de criar', ['cancelar_ultima'], 0.85, 'undo com referência'),
  fx('volta atrás na última operação', ['cancelar_ultima'], 0.9, 'undo coloquial'),
  fx('anular o que registei agora', ['cancelar_ultima'], 0.9, 'undo verbal'),
  fx('elimina a última acção', ['cancelar_ultima'], 0.9, 'undo PT-PT "elimina"'),
  fx('reverter última operação', ['cancelar_ultima'], 0.9, 'undo formal'),
  fx('anula isso', ['cancelar_ultima'], 0.6, 'undo deíctico ambíguo — confiança baixa (FR4 preview)'),
  fx('quero desfazer o que fiz há bocado', ['cancelar_ultima'], 0.85, 'undo coloquial PT'),

  // ──────────────────────────────────────────────────────────────────────────
  // multi-intent × 25 (166-190) — 2 ou mais intents simultâneas
  // ──────────────────────────────────────────────────────────────────────────
  fx('faz compras no supermercado amanhã e regista despesa 78 euros', ['criar_tarefa', 'criar_financa_variavel'], 0.8, 'tarefa + gasto pontual'),
  fx('lembra-me de pagar a renda na sexta e regista despesa 750€ habitação', ['criar_tarefa', 'criar_financa_variavel'], 0.8, 'tarefa + gasto único'),
  fx('agenda jantar com os pais sábado e gastei hoje 18€ no almoço', ['criar_tarefa', 'criar_financa_variavel'], 0.8, 'tarefa futura + gasto presente'),
  fx('paguei a luz 55 euros e a internet 30€ por mês', ['criar_financa_variavel', 'criar_financa_recorrente'], 0.75, 'gasto + recorrente — ambíguo'),
  fx('Netflix 13,99 mensal e gastei 25€ no cinema ontem', ['criar_financa_recorrente', 'criar_financa_variavel'], 0.8, 'recorrente + gasto pontual'),
  fx('compra TV 600€ em 6 prestações e regista cartão Caixa limite 2000', ['criar_parcelada', 'criar_cartao'], 0.75, 'parcelada + cartão'),
  fx('adiciona tarefa comprar pão e mostra-me as despesas desta semana', ['criar_tarefa', 'consultar_dados'], 0.85, 'tarefa + consulta'),
  fx('paguei 45€ no jantar e quantas tarefas tenho hoje', ['criar_financa_variavel', 'consultar_dados'], 0.85, 'gasto + consulta'),
  fx('comprei portátil 1200 em 24 prestações e regista cartão WIZINK limite 1500', ['criar_parcelada', 'criar_cartao'], 0.8, 'parcelada + cartão'),
  fx('Netflix 13,99 por mês e Spotify 6,99 por mês', ['criar_financa_recorrente', 'criar_financa_recorrente'], 0.65, 'duas recorrentes — duplicação intencional ambígua (FR4 preview)'),
  fx('lembra-me de levar o lixo amanhã e regista 12€ no almoço hoje', ['criar_tarefa', 'criar_financa_variavel'], 0.85, 'tarefa + gasto'),
  fx('paguei 80€ no supermercado e renova-me o seguro do carro 45€/mês', ['criar_financa_variavel', 'criar_financa_recorrente'], 0.75, 'pontual + recorrente'),
  fx('adiciona cartão BPI e mostra-me todos os meus cartões', ['criar_cartao', 'consultar_dados'], 0.85, 'criação + consulta'),
  fx('gastei 30€ na farmácia e marca consulta com o médico para sexta', ['criar_financa_variavel', 'criar_tarefa'], 0.85, 'gasto + tarefa'),
  fx('comprei frigorífico 800€ em 12 prestações e ginásio 35€/mês', ['criar_parcelada', 'criar_financa_recorrente'], 0.75, 'parcelada + recorrente'),
  fx('regista 20€ no almoço, agenda jogo do filho domingo, e mostra orçamento', ['criar_financa_variavel', 'criar_tarefa', 'consultar_dados'], 0.7, 'três intents — confiança média'),
  fx('renda 750€/mês, paguei luz 55€ hoje, e quantas tarefas tenho?', ['criar_financa_recorrente', 'criar_financa_variavel', 'consultar_dados'], 0.7, 'três intents'),
  fx('adiciona tarefa pagar Finanças até dia 30 e regista cartão MEO Continente plafond 600€', ['criar_tarefa', 'criar_cartao'], 0.8, 'tarefa + cartão'),
  fx('paguei 18€ café e gastei 65€ na consulta', ['criar_financa_variavel', 'criar_financa_variavel'], 0.8, 'duas despesas variáveis'),
  fx('lembra-me passar férias em Setembro e regista 1800€ em 6 prestações Halcon', ['criar_tarefa', 'criar_parcelada'], 0.8, 'tarefa + parcelada'),
  fx('apontamento dentista quarta e mostra-me despesas saúde este ano', ['criar_tarefa', 'consultar_dados'], 0.85, 'tarefa + consulta filtrada'),
  fx('gastei 14€ no cabeleireiro hoje e telemóvel MEO 25€ todos os meses', ['criar_financa_variavel', 'criar_financa_recorrente'], 0.8, 'pontual + recorrente'),
  fx('comprei prendas 50€ e bicicleta 850€ em 12 prestações', ['criar_financa_variavel', 'criar_parcelada'], 0.8, 'pontual + parcelada'),
  fx('cartão Activobank débito, cartão BPI Visa limite 1500€', ['criar_cartao', 'criar_cartao'], 0.75, 'dois cartões em sequência'),
  fx('marca limpeza geral sábado e regista 90€ de empregada doméstica', ['criar_tarefa', 'criar_financa_variavel'], 0.8, 'tarefa + gasto serviços'),

  // ──────────────────────────────────────────────────────────────────────────
  // unknown × 10 (191-200) — out-of-scope (LLM deve detectar)
  // ──────────────────────────────────────────────────────────────────────────
  fx('qual é a capital de França', ['unknown'], 0.95, 'pergunta geral — out-of-scope'),
  fx('como está o tempo hoje em Lisboa', ['unknown'], 0.9, 'pergunta meteorológica — out-of-scope'),
  fx('conta-me uma piada', ['unknown'], 0.9, 'pedido lúdico — out-of-scope'),
  fx('quem ganhou o Euro 2024', ['unknown'], 0.9, 'pergunta desporto — out-of-scope'),
  fx('traduzir bonjour para português', ['unknown'], 0.9, 'pedido tradução — out-of-scope'),
  fx('quantos quilómetros tem o caminho de Lisboa ao Porto', ['unknown'], 0.85, 'pergunta geral PT — out-of-scope'),
  fx('explica-me o que é a inteligência artificial', ['unknown'], 0.9, 'pergunta conceptual — out-of-scope'),
  fx('quero ouvir música', ['unknown'], 0.85, 'pedido genérico — out-of-scope'),
  fx('o que devo cozinhar para o jantar', ['unknown'], 0.85, 'pedido conselho — out-of-scope'),
  fx('boa tarde', ['unknown'], 0.95, 'saudação — out-of-scope'),
];

/**
 * Array final de fixtures — IDs sequenciais 1..200.
 *
 * Exportado como `readonly` para impedir mutação acidental nos tests.
 */
export const BENCHMARK_FIXTURES: readonly BenchmarkFixture[] = fixturesUnsorted.map(
  (fixture, idx): BenchmarkFixture => ({
    id: idx + 1,
    ...fixture,
  }),
);

/**
 * Distribuição esperada — usada em `benchmark-fixtures.test.ts` AC11(ii) como
 * fonte de verdade para a validação ±5 por categoria definida em AC4.
 *
 * Inclui agora `multi_intent` como categoria sintética (fixtures com
 * `expected_intents.length > 1`).
 */
export const EXPECTED_DISTRIBUTION = {
  criar_tarefa: 40,
  criar_financa_variavel: 40,
  criar_financa_recorrente: 20,
  criar_parcelada: 15,
  criar_cartao: 10,
  consultar_dados: 30,
  cancelar_ultima: 10,
  multi_intent: 25,
  unknown: 10,
} as const;

/**
 * Total esperado — guardrail em test (`benchmark-fixtures.test.ts`).
 */
export const EXPECTED_TOTAL = 200 as const;

/**
 * Tolerância ± por categoria conforme AC4 da Story 2.10.
 */
export const DISTRIBUTION_TOLERANCE = 5 as const;
