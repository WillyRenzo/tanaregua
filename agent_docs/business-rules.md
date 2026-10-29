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
- **Sessões por serviço** (confirmado): o pacote define quantas sessões de cada serviço inclui (ex.: 4 cortes + 2 barbas). Cada serviço aparece uma vez no pacote.
- **Validade em dias a partir da compra** (confirmado): `expiresAt = compra + N dias`. Vencido é derivado da data, não precisa de job.
- **Venda:** o pacote é um item `PACKAGE` (quantidade 1) numa comanda **com cliente identificado**; o pacote do cliente só nasce quando a comanda fecha. A venda do pacote não gera comissão.
- **Uso:** na comanda aberta, um item de serviço do mesmo cliente pode ser pago com sessão de pacote (o item fica R$ 0, sem desconto). A sessão só é consumida quando a comanda fecha; antes disso, nada muda no saldo. O pacote precisa estar ativo, dentro da validade, incluir o serviço e ter saldo, inclusive somando os outros itens da mesma comanda.
- **Valor da sessão:** o preço pago é dividido entre as sessões proporcionalmente ao preço de tabela de cada serviço na hora da compra, arredondando para baixo (nunca distribui mais do que foi pago). Ex.: R$ 220 por 4 cortes de R$ 50 e 2 barbas de R$ 35 → corte vale R$ 40,74 e barba R$ 28,51. O valor fica congelado no pacote do cliente.
- **Comissão por sessão usada** (confirmado): quem atende ganha a comissão normal do serviço (§4), calculada sobre o valor da sessão. A barbearia pode desligar isso por pacote ("Sessões geram comissão"); a escolha é congelada na venda.
- **Estorno:** estornar a comanda de uso devolve as sessões. Estornar a comanda de venda só é permitido se nenhuma sessão foi usada e o pacote não foi reembolsado (o pacote vira estornado); senão, estorne antes as comandas de uso.
- **Quem faz:** dono e recepção cadastram pacotes (`packages:manage`); o profissional só consulta. Reembolsar exige a permissão de estorno (`orders:void`), porque tira dinheiro do caixa. O reembolso sai no caixa do dia em que é feito, na forma de pagamento escolhida.
- **Cliente:** vê o saldo dos pacotes ativos e vencidos em "Meus agendamentos", só para consulta.

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
- Assinatura do TaNaRegua (plano, cobrança, checkout e avisos de reajuste): só o dono (`subscription:manage`).
- Cliente final: agenda, cancela (dentro da política) e vê o próprio histórico. Não acessa o painel.

## 9. Clientes, aniversários e campanhas (LGPD)

- Nome, telefone, e-mail e data de nascimento são dados pessoais (LGPD).
- **Consentimento por canal** (e-mail e WhatsApp), cada um com a data em que foi dado; conceder de novo mantém a data original. Mensagem de aniversário ou campanha só sai pelo canal que o cliente aceitou, com contato válido nele. O consentimento é conferido de novo na hora do envio: quem revogou depois de entrar na fila não recebe. Sem consentimento, o aniversário aparece só como lembrete interno para a equipe.
- Canais: **e-mail e WhatsApp**, cada um por uma porta própria com adapter trocável. WhatsApp pela **Cloud API da Meta**, com **conexão manual**: a barbearia informa o ID do número, o ID da conta do WhatsApp Business e o token, que o sistema confere na Meta antes de salvar. O cadastro integrado da Meta (Embedded Signup) pode substituir a conexão manual depois, sem mudar regra.
- **WhatsApp só por modelo aprovado pela Meta:** mensagem iniciada pela barbearia não aceita texto livre. O sistema usa só modelos com variáveis no corpo (sem mídia), preenchidas com o primeiro nome do cliente ou o nome da barbearia. A Meta cobra cada mensagem da conta da barbearia.
- **Mensagem automática de aniversário** (opcional, desligada por padrão): sai no dia do aniversário, **uma por cliente por ano**. Vai pelo WhatsApp se o cliente aceitou esse canal e a barbearia escolheu um modelo; senão, por e-mail, se aceitou. Quem nasceu em 29/02 recebe em 28/02 nos anos não bissextos. O texto do e-mail é editável (`{nome}`, `{barbearia}`).
  - **[PROPOSTA]** a mensagem sai a partir das **9h** no fuso da barbearia.
- **Campanhas:** filtro simples (todos, sem visita há N dias, aniversariantes de um mês, fez um serviço nos últimos N dias) e canal; a prévia mostra quantos atendem ao filtro e quantos vão receber. Enviar exige confirmar esse número: se o público mudou desde a prévia, a campanha não sai e o número novo aparece para nova confirmação. Campanha enviada não se edita nem se apaga.
  - "Sem visita há N dias" considera o último atendimento concluído; quem nunca veio não entra.
  - **[PROPOSTA]** no máximo 2.000 destinatários por campanha.
- Todo e-mail de aniversário ou campanha sai com um rodapé dizendo por que o cliente recebe e como parar de receber.
- **[PROPOSTA] Quem faz:** campanhas, dono e recepção (`campaigns:manage`); conectar o WhatsApp e configurar a mensagem de aniversário, quem configura a barbearia (`barbershop:manage`); a lista de aniversariantes, quem vê clientes (`clients:read`).
- O cliente pode pedir exclusão ou anonimização. O histórico financeiro é mantido anonimizado.

## 12. Assinatura e planos (como o TaNaRegua é vendido)

- **Usar o sistema exige assinatura ativa**, por barbearia (tenant). Quem assina e paga é o dono; a cobrança é recorrente.
- **Vários planos.** Cada plano é um conjunto de **recursos** (e, se preciso, limites). Confirmado:
  - o plano **mais básico** inclui só as **fases 1 e 2** (agenda, agendamento online, comanda, comissões, caixa, relatórios básicos, estoque, pacotes, aniversários, identidade visual…);
  - o plano **mais caro** inclui o **assistente de IA** (fase 4).
  - **[PROPOSTA]** três planos: **Essencial** (fases 1 e 2), **Profissional** (+ fase 3: pagamento online, salários e relatórios avançados) e **Premium** (+ assistente de IA). Nomes, preços e o conteúdo exato de cada um ainda serão definidos. Já estão cadastrados assim; mudar é dado, não código.
- **Ciclos mensal e anual** (confirmado em 28/10/2026). Cada plano tem um preço por ciclo, em centavos, **configurado na administração da plataforma** (sem código nem migration). Sem preço num ciclo, o plano não é vendido nele; o desconto do anual é só a diferença entre os dois preços.
  - **Reajuste vale para todos** (confirmado em 28/10/2026): mudar o preço de um plano num ciclo reajusta **todas as assinaturas pagas** daquele plano e ciclo. Não existe "preço antigo" guardado por assinatura.
  - **Aviso de 30 dias por e-mail** (confirmado em 29/10/2026): ao salvar o preço novo, quem cuida da assinatura (`subscription:manage`, o dono) recebe um e-mail com o valor atual, o novo e a data. O novo valor passa ao gateway **30 dias depois** e vale a partir da primeira cobrança seguinte (o mensal na mensalidade, o anual na renovação). Vale também para redução de preço. Mudar o preço de novo dentro dos 30 dias substitui o reajuste anterior (com novo aviso e novo prazo); voltar ao valor que a barbearia já paga desfaz o reajuste; salvar o mesmo valor não avisa de novo. Quem conclui um checkout aberto antes da mudança também recebe o aviso.
  - **Ciclo com assinante não sai de venda** (confirmado em 29/10/2026): a administração não consegue apagar o preço de um plano num ciclo enquanto houver assinatura paga (não cancelada) nele.
- **Administração da plataforma** (`/admin`): quem administra o TaNaRegua entra com conta e login próprios, separados das barbearias, e não vê dados de nenhuma barbearia. As contas são criadas só por comando no servidor (`deploy/README.md`), nunca pela aplicação.
  - **[PROPOSTA]** senha com no mínimo 12 caracteres e sessão de 12 horas.
- **Teste grátis** (confirmado em 30/10/2026): a barbearia nova começa com **14 dias no plano mais completo (Premium), sem cartão**. As que já existiam sem assinatura paga ganharam o mesmo teste, contado a partir do lançamento (a migration). Quem assina durante o teste **paga na hora**, e o teste acaba ali.
- **Período pago e carência** (confirmado em 30/10/2026): cada cobrança aprovada libera um ciclo a partir dela. Passado o fim do período pago sem nova cobrança aprovada, há **7 dias de carência** com tudo funcionando e um aviso no painel; o gateway tenta cobrar de novo nesse meio tempo.
- **Modo só leitura** (confirmado em 30/10/2026): com o teste vencido, a carência esgotada ou a assinatura cancelada depois do período pago, **o painel só consulta** (a API recusa toda escrita com 402 `subscription-inactive`) e **a página pública de agendamento continua** para os clientes. Assinar volta tudo ao normal na hora; cancelar continua possível. Nada é apagado, e a consulta inclui o que o plano tinha.
  - **[PROPOSTA]** as mensagens automáticas já configuradas (aniversário) continuam saindo no modo só leitura, como a página pública.
- **Cortesia:** assinatura ativa sem gateway não vence. Não há como criar isso pela aplicação: só o seed de desenvolvimento e o suporte, direto no banco.
- **Criar ou mudar planos não exige código.** Assim como as permissões (§8), o sistema checa **recursos**, nunca o nome do plano. Um plano novo é um registro novo com a lista de recursos dele.
- **Acesso efetivo = permissão do papel E recurso do plano.** Ex.: a recepcionista tem `assistant:use`, mas só usa o assistente se a barbearia estiver num plano com o recurso do assistente.
- **Recurso fora do plano:** a API recusa (erro `plan-upgrade-required`) e o painel mostra o recurso como "disponível no plano X", com convite para trocar de plano. Esconder no frontend não basta: quem garante é a API.
- **Trocar para um plano menor nunca apaga dados.** O que ficou fora do plano só fica inacessível até um novo upgrade (ex.: o histórico de folha continua no banco).
- **Cobrança pela porta `PaymentGateway`** (§5): a mesma de pagamento online, Mercado Pago como adapter inicial. O status da assinatura só muda por **webhook verificado** ou consulta ao gateway, e o processamento é idempotente. O sistema nunca guarda dados de cartão.
  - **Assinar:** em Configurações, o dono (`subscription:manage`) escolhe plano e ciclo e vai ao **checkout hospedado do gateway**; o preço vem sempre do catálogo. O plano só muda quando o gateway confirma a autorização, nunca pelo retorno do navegador.
  - Clicar de novo no mesmo plano, ciclo e preço em até 1 hora reaproveita o checkout aberto. Abrir outro checkout cancela os abertos antes, também no gateway. Um checkout antigo aprovado depois disso não vale e é cancelado no gateway (nada de cobrança em dobro).
  - **Com assinatura paga ativa, não se abre outro checkout:** muda-se de plano pela troca de plano. Com a assinatura cancelada, o dono pode assinar de novo (um checkout novo, cobrado na hora).
  - **Troca de plano** (confirmado em 30/10/2026), só com a assinatura paga em dia e **no mesmo ciclo**:
    - **upgrade vale na hora**; o gateway passa a cobrar o valor novo **a partir da próxima cobrança**, sem cobrança proporcional;
    - **downgrade vale no fim do período pago**: até lá, a barbearia segue no plano atual; a próxima cobrança já sai no valor do plano novo;
    - escolher de novo o plano atual desfaz um downgrade agendado; um reajuste avisado do plano antigo deixa de valer (o valor é o do plano novo no catálogo).
    - **Troca de ciclo** (mensal ↔ anual) fica para depois: por enquanto, cancela e assina de novo no outro ciclo.
  - **Cancelamento pelo painel** (confirmado em 30/10/2026): cancela a cobrança recorrente no gateway na hora; a barbearia **usa até o fim do período pago** e depois fica só para consulta. Uma notificação antiga do gateway não reativa uma assinatura cancelada.
  - **Situação vinda do gateway:** autorizada = ativa; pausada = em atraso; cancelada = cancelada. O acesso não depende do rótulo: segue o período pago e a carência acima.
  - Sem gateway configurado na instalação (`PAYMENT_PROVIDER=none`), a assinatura online fica indisponível e o painel diz para falar com o suporte.
- **[PENDENTE]**
  - valores dos preços e nomes definitivos (o seed de desenvolvimento usa preços fictícios);
  - troca de ciclo (mensal ↔ anual) com a assinatura paga;
  - limites por plano (ex.: número de profissionais, uso do assistente);
  - emissão de nota fiscal da assinatura.
