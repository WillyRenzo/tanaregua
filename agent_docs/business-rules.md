# Regras de Negócio e Domínio

Regras que, se violadas, causam problema real: dinheiro errado, dados vazando
entre barbearias, agenda inconsistente ou quebra da LGPD. Itens marcados como
**[PROPOSTA]** são defaults razoáveis ainda não confirmados pelo dono do
produto. Itens **[PENDENTE]** precisam de decisão antes de serem implementados.
Não invente regra para preencher uma lacuna: pergunte.

## 1. Multi-tenancy (cada barbearia é um tenant)

- Cada barbearia é um tenant isolado. **Nenhum dado pode vazar entre barbearias**: nem em listagens, nem em relatórios, nem em buscas, nem em mensagens de erro.
- Todo registro que pertence a um tenant tem `barbershopId`.
- O `barbershopId` da requisição vem **sempre do token autenticado**, nunca do body, da query ou de um parâmetro de rota enviado pelo cliente.
- **Única exceção:** as rotas públicas de agendamento (`/v1/public/:slug/…`) resolvem o tenant pelo slug, no servidor. Nas rotas públicas autenticadas (reservar, cancelar, "meus agendamentos"), o tenant do token precisa ser o mesmo do slug; se não for, a resposta é 404.
- O isolamento é imposto em duas camadas: na aplicação (filtro obrigatório por tenant) e no banco (Postgres RLS). Veja `security.md` e `architecture.md`.
- Recurso de outro tenant responde **404**, não 403, para não revelar que ele existe.
- Um cliente final pode ser atendido por várias barbearias com **uma única conta de login**; o **cadastro de cliente é por barbearia** (cada tenant tem o seu, sem compartilhar histórico). Ao entrar pela página de outra barbearia, a conta ganha um cadastro novo ali.
- Slugs reservados (colidem com rotas do frontend: `painel`, `entrar`, `cadastro`, `api`…) não podem ser usados por barbearias. A lista fica em `RESERVED_SLUGS` (backend/src/modules/auth/auth.schemas.ts).

## 2. Agenda e agendamentos

- **Um profissional não pode ter dois atendimentos sobrepostos.** Essa é a regra mais crítica do sistema.
  - Ela é imposta **no banco**, com uma exclusion constraint (`btree_gist` + `tstzrange(startsAt, endsAt, '[)')` com `professionalId WITH =` e `&&`), restrita a status ativos (exclui cancelado e não compareceu). Validar só na aplicação não basta, porque duas requisições simultâneas passariam pela checagem.
  - A aplicação também valida antes de gravar, para devolver um erro amigável. O banco é a garantia final.
  - O intervalo é `[início, fim)`: atendimentos encostados (um termina 10:00, outro começa 10:00) são válidos.
  - Cuidado ao filtrar a constraint por status: a condição `WHERE` precisa deixar de fora os status inativos. Ela não pode só checar quando a linha nova é "agendada", porque isso deixa passar conflitos.
- A duração do atendimento vem dos serviços escolhidos (soma das durações).
- **Intervalo entre atendimentos (buffer):** configurável por barbearia, padrão 0. Cada agendamento grava `blocked_until = fim + buffer`, e é esse intervalo que a exclusion constraint compara; ou seja, o buffer também é garantido pelo banco. Mudar o buffer não altera agendamentos já feitos.
- Horários são gravados em UTC (`timestamptz`) e exibidos no fuso da barbearia (campo `timezone` por barbearia, padrão `America/Sao_Paulo`).
- O agendamento online só oferece horários dentro do expediente do profissional, fora de bloqueios/folgas e sem conflito, numa grade de 15 minutos. O painel aceita encaixe fora do expediente, mas nunca em folga nem com conflito.
- "Qualquer profissional" no agendamento online: o sistema escolhe o primeiro profissional (na ordem da equipe) livre no horário.
- **Cancelamento online pelo cliente:** permitido até uma antecedência mínima configurável por barbearia (padrão **2 horas**), sem multa no MVP. Depois disso, só a barbearia cancela.
- **Reagendamento pelo próprio cliente** (fase 2): permitido até uma antecedência mínima configurável por barbearia (padrão **24 horas** antes do horário atual do agendamento). O novo horário segue as mesmas regras da reserva online (grade, expediente, folgas, conflito). Depois do prazo, só a barbearia reagenda.
- **Sem multa e sem limite de faltas.** O cliente que falta continua podendo agendar.
- **Falta sem justificativa** (fase 2): ao marcar "não compareceu", a barbearia pode registrar uma justificativa. Falta sem justificativa fica visível para a equipe no cadastro do cliente e no agendamento (contagem e datas), só como informação: não bloqueia nada e não aparece para o cliente.
- **[PENDENTE]** se o mesmo cliente pode ter dois atendimentos simultâneos com profissionais diferentes.

## 3. Comandas (serviços executados)

- A comanda registra os serviços executados e os produtos vendidos em um atendimento. É a fonte da verdade para financeiro, comissões e estoque.
- **Comanda fechada/paga é imutável.** Correções são feitas com estorno (comanda vira VOIDED e caixa e comissões ganham lançamentos negativos), nunca editando ou apagando itens. Garantido também no banco: trigger bloqueia mudanças em itens de comanda não aberta, e o usuário da aplicação não tem UPDATE/DELETE nos lançamentos.
- Comanda aberta por engano pode ser descartada (VOIDED sem lançamentos). Uma comanda por agendamento.
- MVP: uma forma de pagamento por comanda (dinheiro, Pix, débito, crédito, outro), só registrada; o pagamento acontece na maquininha/balcão.
- Cada item guarda um snapshot do preço e da regra de comissão vigentes no momento. Mudar o preço de um serviço depois não altera comandas antigas.

## 4. Financeiro, comissões e salários

- Valores monetários são **inteiros em centavos** (BRL). Nunca use float/decimal JS para dinheiro. Arredondamento é explícito e acontece em um único lugar.
- A comissão é configurável por serviço e/ou por funcionário, como percentual ou valor fixo.
  - Precedência (confirmada): regra específica funcionário+serviço > regra do serviço > padrão do funcionário. Sem regra aplicável, não há comissão.
  - Percentual em **basis points** (4000 = 40%); valor fixo em centavos. Arredondamento: meio centavo para cima, só em `calculateCommissionCents`.
  - A comissão nunca passa do valor cobrado pelo item (confirmada): um fixo de R$ 15 sobre um item de R$ 10 com desconto gera R$ 10.
  - A comissão é calculada no fechamento da comanda e gravada (snapshot). Mudar a configuração não recalcula o passado.
  - **Produtos** (confirmado): a venda de produto gera comissão configurável (percentual ou fixo), com precedência **profissional+produto > produto**. O **padrão do profissional não vale para produto**: sem regra de produto, não há comissão. Venda de balcão (produto sem profissional) nunca gera comissão.
- Salários e comissões de terceiros são dados sensíveis: só o dono/admin vê. O profissional vê apenas as próprias comissões.
- Relatórios financeiros derivam de comandas fechadas e lançamentos, nunca de agendamentos.

## 5. Pagamento online

- **Desacoplado do fornecedor.** O domínio fala só com a porta `PaymentGateway`; cada gateway é um adapter escolhido por configuração. Trocar de gateway não muda regra de negócio nem tabela (IDs externos ficam em colunas genéricas, com o nome do provedor). Ver `architecture.md`.
- **Gateway inicial: Mercado Pago**, como um adapter. A escolha definitiva ainda pode mudar; por isso nenhuma regra, tela ou tabela pode depender de algo exclusivo do Mercado Pago.
- O status do pagamento só muda por **webhook verificado** (assinatura validada) ou por consulta direta ao gateway. Nunca confie no redirect do frontend.
- O processamento de webhook é **idempotente**: o mesmo evento recebido duas vezes não pode gerar dois lançamentos.
- O sistema nunca armazena dados de cartão. Usa só os tokens/IDs do gateway.

## 6. Pacotes de serviços

- O cliente compra um pacote com N sessões de um ou mais serviços. Cada uso consome uma sessão, vinculada à comanda.
- O pacote é vendido como item da comanda e pago no balcão, com as formas de pagamento normais. Isso conta como pagamento antecipado. (Pagamento online do pacote: fase 3.)
- O saldo de sessões nunca fica negativo.
- **Validade configurável** por pacote (definida pela barbearia ao criar o pacote). Sessões não usadas até a data de validade expiram e não podem mais ser consumidas.
- **Intransferível:** o pacote pertence ao cliente que comprou e não pode ser passado para outro cliente.
- **Reembolso só quando o pacote foi pago antecipadamente.** O reembolso gera lançamento negativo no caixa (nunca apaga a venda) e encerra o pacote.
- **O valor do reembolso é definido pela barbearia** a cada reembolso (até o valor pago pelo pacote), com motivo registrado.
- **Pacote vencido não pode ser reembolsado.**

## 7. Estoque e produtos

- Vender um produto na comanda dá baixa no estoque ao fechar a comanda. Estornar devolve.
- Toda movimentação de estoque gera um registro (entrada, saída, ajuste) com autor e motivo. O saldo é derivado ou conciliável com esse histórico.
- **A quantidade em estoque nunca fica negativa.** Fechar uma comanda que venderia mais do que o saldo é recusado com erro claro (garantido também no banco, sob concorrência).
- **O valor total do estoque pode ficar negativo.** A valorização (custo × quantidade, com ajustes e devoluções a custos diferentes) não tem trava; é informativa.
- Movimentações: **entrada** (soma e vira o custo de referência), **venda** e **estorno de venda** (pela comanda), **ajuste** (±, sempre com motivo: perda, quebra, contagem). Cadastro e edição do produto nunca mexem no saldo.
- **Venda na comanda:** o produto pode ter o profissional que vendeu (pode gerar comissão) ou ser venda de balcão (sem profissional, sem comissão).
- **Estoque mínimo** opcional por produto: com saldo **no mínimo ou abaixo**, o produto aparece para repor.
- **Quem mexe:** dono e recepção cadastram produtos e movimentam o estoque (`products:manage`); o profissional só consulta (`products:read`) e não vê custo nem valor em estoque. Regras de comissão de produto continuam só com o dono (`services:manage`).

## 10. Identidade visual por barbearia (fase 2)

- Cada barbearia pode enviar o **logo** e escolher as **cores da marca**, aplicados na página pública de agendamento **e** no painel da equipe dela. Sem configuração, vale a identidade TaNaRegua.
- **Duas cores, cada uma opcional:** a **principal** vai para botões, links, foco, o destaque do menu e o **fundo do menu** (e da barra do topo da página pública), escurecida só o necessário para o texto claro do menu ficar legível; a **secundária**, para fundos de seleção e o item ativo do menu. Sem uma delas, aquela parte segue o padrão TaNaRegua.
- Logo: PNG, JPEG ou WebP até 1 MB, reprocessado para no máximo 512 px. A página pública pode levar alguns minutos para refletir a mudança (cache).
- A personalização nunca quebra a acessibilidade: o sistema deriva as cores de texto e destaque garantindo contraste WCAG AA; se a cor escolhida não permitir, ela é ajustada (e o dono vê a prévia).
- Só quem tem permissão de configurações da barbearia altera a identidade visual.
- **Domínio próprio (entra com o deploy, B7) é opcional e responsabilidade da barbearia assinante:** ela compra o domínio (ex.: `agendar.barbeariadoze.com.br`) e aponta o DNS para a plataforma. O sistema só aceita o domínio depois de verificar que ele aponta para nós, e emite o HTTPS automaticamente. Sem domínio próprio, vale `tanaregua…/{slug}`.

## 11. Assistente de IA (fase 4)

- O dono conversa com um assistente dentro do painel, que interpreta pedidos e executa tarefas no sistema (ex.: "cadastre os produtos desta planilha").
- O assistente age **como o usuário que está conversando**: só faz o que as permissões dele permitem e só enxerga a barbearia dele. Ele usa as mesmas regras de negócio da API; não tem atalho para o banco.
- **Toda escrita pede confirmação.** Antes de criar, alterar ou apagar, o assistente mostra o que vai fazer (ex.: prévia dos 40 produtos lidos da planilha, com linhas inválidas destacadas) e só executa depois do "confirmar".
- Toda ação executada pelo assistente fica registrada (quem pediu, o quê, quando) e aparece no histórico.
- **Quem usa:** só dono/admin e recepcionista (permissão própria, `assistant:use`, concedida a esses dois papéis; profissional e cliente não têm). Dentro do assistente continuam valendo as permissões de cada um: a recepção não vê salários nem comissões de terceiros por ele.
- **LGPD:** o assistente não expõe dados sensíveis de clientes. Ao provedor de IA vai só o necessário para a tarefa; telefone, e-mail e data de nascimento são mascarados ou substituídos por identificadores, e os dados completos aparecem na tela vindos direto da API, não do texto gerado pela IA.
- **Disponível só no plano mais completo** (§12). **[PENDENTE]** limite de uso dentro do plano (ex.: mensagens por mês).

## 8. Usuários, papéis e permissões

- Papéis atuais: **dono/admin**, **profissional (barbeiro)**, **recepcionista** e **cliente final**.
- **Novos papéis precisam ser possíveis sem reescrever guards.** Autorização é feita por **permissão** (ex.: `appointments:read:any`, `commissions:read:own`), e cada papel é um conjunto de permissões. O código checa permissões, nunca nomes de papéis. O catálogo fica em `backend/src/modules/auth/permissions.ts`; numa rota, basta UMA das permissões declaradas, e o escopo `:own` vs `:any` é aplicado no service.
- Profissional: vê e gerencia a própria agenda e as próprias comissões.
- Recepcionista: gerencia agenda de todos e caixa/comandas. Não vê salários.
- Cliente final: agenda, cancela (dentro da política) e vê o próprio histórico. Não acessa o painel.

## 9. Clientes e aniversários (LGPD)

- Nome, telefone, e-mail e data de nascimento são dados pessoais (LGPD).
- Mensagens de aniversário ou marketing exigem consentimento registrado (data e canal). Sem consentimento, o aniversário aparece só como lembrete interno.
- Canais (fase 2): **e-mail e WhatsApp**, cada um por uma porta própria com adapter trocável. A mensagem só sai pelo canal que o cliente consentiu. Provedor de WhatsApp **[PENDENTE]**.
- O cliente pode pedir exclusão ou anonimização. O histórico financeiro é mantido anonimizado.

## 12. Assinatura e planos (como o TaNaRegua é vendido)

- **Usar o sistema exige assinatura ativa**, por barbearia (tenant). Quem assina e paga é o dono; a cobrança é recorrente.
- **Vários planos.** Cada plano é um conjunto de **recursos** (e, se preciso, limites). Confirmado:
  - o plano **mais básico** inclui só as **fases 1 e 2** (agenda, agendamento online, comanda, comissões, caixa, relatórios básicos, estoque, pacotes, aniversários, identidade visual…);
  - o plano **mais caro** inclui o **assistente de IA** (fase 4).
  - **[PROPOSTA]** três planos: **Essencial** (fases 1 e 2), **Profissional** (+ fase 3: pagamento online, salários e relatórios avançados) e **Premium** (+ assistente de IA). Nomes, preços e o conteúdo exato de cada um ainda serão definidos.
- **Criar ou mudar planos não exige código.** Assim como as permissões (§8), o sistema checa **recursos**, nunca o nome do plano. Um plano novo é um registro novo com a lista de recursos dele.
- **Acesso efetivo = permissão do papel E recurso do plano.** Ex.: a recepcionista tem `assistant:use`, mas só usa o assistente se a barbearia estiver num plano com o recurso do assistente.
- **Recurso fora do plano:** a API recusa (erro `plan-upgrade-required`) e o painel mostra o recurso como "disponível no plano X", com convite para trocar de plano. Esconder no frontend não basta: quem garante é a API.
- **Trocar para um plano menor nunca apaga dados.** O que ficou fora do plano só fica inacessível até um novo upgrade (ex.: o histórico de folha continua no banco).
- **Cobrança pela porta `PaymentGateway`** (§5): a mesma de pagamento online, Mercado Pago como adapter inicial. O status da assinatura só muda por **webhook verificado** ou consulta ao gateway, e o processamento é idempotente. O sistema nunca guarda dados de cartão.
- **[PENDENTE]**
  - preços, nomes definitivos, ciclo (mensal/anual) e desconto anual;
  - período de teste grátis (duração e qual plano durante o teste);
  - inadimplência: dias de carência, o que acontece depois (ex.: painel só leitura, página pública de agendamento continua ou para) e reativação;
  - troca de plano no meio do ciclo (cobrança proporcional ou só no próximo ciclo);
  - limites por plano (ex.: número de profissionais, uso do assistente);
  - emissão de nota fiscal da assinatura;
  - plano das barbearias que já existirem quando a cobrança começar.
