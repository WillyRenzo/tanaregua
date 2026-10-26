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
- **[PENDENTE]** reagendamento pelo próprio cliente, multa e limite de no-shows.
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
  - **[PROPOSTA]** a comissão nunca passa do valor cobrado pelo item (um fixo de R$ 15 sobre um item de R$ 10 com desconto gera R$ 10). Confirmar com o dono do produto.
  - A comissão é calculada no fechamento da comanda e gravada (snapshot). Mudar a configuração não recalcula o passado.
- Salários e comissões de terceiros são dados sensíveis: só o dono/admin vê. O profissional vê apenas as próprias comissões.
- Relatórios financeiros derivam de comandas fechadas e lançamentos, nunca de agendamentos.

## 5. Pagamento online

- Gateway **[PENDENTE]** (Mercado Pago, Asaas, Stripe...).
- O status do pagamento só muda por **webhook verificado** (assinatura validada) ou por consulta direta ao gateway. Nunca confie no redirect do frontend.
- O processamento de webhook é **idempotente**: o mesmo evento recebido duas vezes não pode gerar dois lançamentos.
- O sistema nunca armazena dados de cartão. Usa só os tokens/IDs do gateway.

## 6. Pacotes de serviços

- O cliente compra um pacote com N sessões de um ou mais serviços. Cada uso consome uma sessão, vinculada à comanda.
- O saldo de sessões nunca fica negativo.
- **[PENDENTE]** validade/expiração, transferência entre clientes e reembolso parcial.

## 7. Estoque e produtos

- Vender um produto na comanda dá baixa no estoque ao fechar a comanda. Estornar devolve.
- Toda movimentação de estoque gera um registro (entrada, saída, ajuste) com autor e motivo. O saldo é derivado ou conciliável com esse histórico.
- **[PENDENTE]** se é permitido vender com estoque zerado/negativo.

## 8. Usuários, papéis e permissões

- Papéis atuais: **dono/admin**, **profissional (barbeiro)**, **recepcionista** e **cliente final**.
- **Novos papéis precisam ser possíveis sem reescrever guards.** Autorização é feita por **permissão** (ex.: `appointments:read:any`, `commissions:read:own`), e cada papel é um conjunto de permissões. O código checa permissões, nunca nomes de papéis. O catálogo fica em `backend/src/modules/auth/permissions.ts`; numa rota, basta UMA das permissões declaradas, e o escopo `:own` vs `:any` é aplicado no service.
- Profissional: vê e gerencia a própria agenda e as próprias comissões.
- Recepcionista: gerencia agenda de todos e caixa/comandas. Não vê salários.
- Cliente final: agenda, cancela (dentro da política) e vê o próprio histórico. Não acessa o painel.

## 9. Clientes e aniversários (LGPD)

- Nome, telefone, e-mail e data de nascimento são dados pessoais (LGPD).
- Mensagens de aniversário ou marketing exigem consentimento registrado (data e canal). Sem consentimento, o aniversário aparece só como lembrete interno.
- O cliente pode pedir exclusão ou anonimização. O histórico financeiro é mantido anonimizado.
