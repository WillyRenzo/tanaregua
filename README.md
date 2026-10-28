# TaNaRegua

Gestão completa para barbearias e salões: agenda integrada, agendamento online,
comandas, comissões, caixa e relatórios, num SaaS multi-tenant pensado para
pequenos negócios.

> **Status:** MVP funcional, com estoque e pacotes de serviços. Aniversários,
> pagamento online e folha de salários estão no roadmap.

## Funcionalidades

**Painel da barbearia**

- **Agenda integrada:** uma coluna por profissional, com expediente, folgas e atendimentos do dia, além das visões de semana e de mês e do filtro por profissional. O sistema não deixa marcar dois atendimentos no mesmo horário para o mesmo profissional.
- **Comandas:** abertas a partir do agendamento ou avulsas, com desconto por item. Ao fechar, a comissão de cada profissional é calculada e congelada.
- **Comissões configuráveis:** por serviço, por profissional ou pela combinação dos dois, em percentual ou valor fixo.
- **Produtos e estoque:** venda na comanda, entradas e ajustes com histórico, alerta de reposição. O estoque nunca fica negativo.
- **Pacotes de serviços:** sessões antecipadas (ex.: 4 cortes + 2 barbas) vendidas na comanda, com validade em dias, saldo por serviço e reembolso pela barbearia.
- **Caixa do dia e relatórios:** faturamento por dia, por profissional e por serviço, além da taxa de não comparecimento.
- **Equipe e papéis:** dono, recepcionista e profissional, com permissões granulares (o profissional vê só a própria agenda e as próprias comissões).
- **Clientes com LGPD:** consentimento registrado para mensagens e exclusão de dados pessoais sob pedido, preservando o histórico financeiro.

**Página pública de agendamento** (`/{slug-da-barbearia}`)

- O cliente escolhe serviço, profissional (ou "qualquer um") e horário livre, e cria a conta em poucos segundos.
- Confirmação por e-mail, "Meus agendamentos" e cancelamento online dentro do prazo definido pela barbearia.
- Saldo dos pacotes comprados ("Meus pacotes").

## Stack

| Camada | Tecnologias |
|---|---|
| Backend | Node.js 24, NestJS 12 (ESM), Prisma 7, Zod |
| Banco | PostgreSQL 18 com Row Level Security |
| Frontend | Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS 4, shadcn/ui, TanStack Query |
| Testes | Vitest, Testcontainers, Playwright, axe-core |
| Infra | Docker Compose, GitHub Actions |

## Destaques técnicos

- **Isolamento entre barbearias em camadas.** O tenant vem sempre do token. A aplicação filtra por barbearia, o Postgres aplica Row Level Security (fail-closed) e chaves estrangeiras compostas impedem referências cruzadas mesmo passando por cima da aplicação.
- **Regras críticas garantidas pelo banco.** Uma *exclusion constraint* impede conflito de horário mesmo sob requisições simultâneas, com o intervalo entre atendimentos incluído. Triggers tornam a comanda fechada imutável, e os lançamentos financeiros são append-only: correção só por estorno.
- **Contrato de API único.** Os schemas Zod validam a entrada, tipam a saída e geram o OpenAPI, de onde sai o cliente tipado do frontend. O CI barra quando backend e frontend divergem.
- **Eventos confiáveis.** E-mails saem por uma *outbox* transacional, com retry, backoff exponencial, dead letter e envio idempotente.
- **Dinheiro sem ponto flutuante.** Valores em centavos e percentuais em basis points, com um único ponto de arredondamento.
- **Acessibilidade e fuso horário tratados desde o início.** WCAG 2.2 AA verificado automaticamente; datas sempre no fuso da barbearia, inclusive em fusos com horário de verão.

A arquitetura e as decisões de design estão em [`agent_docs/architecture.md`](agent_docs/architecture.md),
e as regras de negócio em [`agent_docs/business-rules.md`](agent_docs/business-rules.md).

## Como rodar localmente

Pré-requisitos: **Docker** com Docker Compose. O Node.js roda dentro dos containers e não precisa estar instalado na máquina.

```bash
# 1. Variáveis de ambiente do backend
cp backend/.env.example backend/.env
# edite backend/.env e preencha JWT_ACCESS_SECRET (mínimo de 32 caracteres), por exemplo:
#   openssl rand -base64 48

# 2. Banco de dados
docker compose up -d db

# 3. Dependências, client do Prisma e migrations
#    `npm ci` apaga e recria o node_modules: com a API ou o frontend rodando, eles
#    quebram (erro 500). Se já tinha subido a stack antes, pare-os primeiro:
docker compose stop backend frontend
docker compose run --rm --no-deps backend sh -c "npm ci && npm run db:generate && npx prisma migrate deploy"
docker compose run --rm --no-deps frontend npm ci

# 4. Dados de demonstração (opcional, recomendado)
docker compose run --rm --no-deps backend npm run db:seed

# 5. Subir tudo
docker compose up -d
```

| Serviço | Endereço |
|---|---|
| Aplicação web | http://localhost:3000 |
| API | http://localhost:3333 |
| Documentação da API (Swagger) | http://localhost:3333/docs |

Crie sua barbearia em http://localhost:3000/cadastro. A página pública de agendamento
fica em `http://localhost:3000/<slug-escolhido>`.

### Contas de teste (seed de demonstração)

O passo 4 cria a **Barbearia Demo** pronta para explorar, com uma conta para cada papel.
Senha de todas as contas: **`senha-forte-123`**.

| Papel | E-mail | Onde entrar | O que dá para testar |
|---|---|---|---|
| Dono (também atende) | `dono@demo.tanaregua.test` | [/entrar](http://localhost:3000/entrar) | Tudo: relatórios, configurações, equipe, comissões, estorno de comanda |
| Recepcionista | `recepcao@demo.tanaregua.test` | [/entrar](http://localhost:3000/entrar) | Agenda de todos, clientes, comandas e caixa. Sem relatórios e sem estorno |
| Profissional | `bia@demo.tanaregua.test` | [/entrar](http://localhost:3000/entrar) | Só a própria agenda e as próprias comissões |
| Profissional | `rafa@demo.tanaregua.test` | [/entrar](http://localhost:3000/entrar) | Idem, para comparar com a Bia |
| Cliente | `cliente@demo.tanaregua.test` | [/barbearia-demo](http://localhost:3000/barbearia-demo) | Agendar online, "Meus agendamentos", reagendar (até 24 h antes) e cancelar (até 2 h antes) |
| Dona de outra barbearia | `dono@vizinha.tanaregua.test` | [/entrar](http://localhost:3000/entrar) | Isolamento: não enxerga nada da Barbearia Demo |

**O que já vem cadastrado** (dá para navegar por todas as telas com dados):
- **Equipe:** três profissionais (o dono, a Bia e o Rafa) e a recepcionista, com expediente; folga da Bia amanhã à tarde e férias do Rafa na semana seguinte.
- **Serviços:** sete serviços (um desativado) e regras de comissão em todos os níveis de precedência.
- **Clientes:** vinte clientes, alguns com consentimento de marketing, aniversariantes no mês e um cliente anonimizado (LGPD), que some da lista mas continua no histórico.
- **Identidade visual:** a Barbearia Demo tem cores próprias (azul e dourado) e logo no painel e na página pública; veja e mude em Configurações → Identidade visual.
- **Produtos e estoque:** quatro produtos ativos e um desativado, com entradas, reposição, vendas na comanda (pelo barbeiro e no balcão), um ajuste por avaria, comissões de produto e o shampoo abaixo do mínimo (alerta de reposição em Produtos).
- **Pacotes:** "Combo do mês" (4 cortes + 2 barbas) e "Barba mensal" (sessões sem comissão). O Carlos e a Paula têm combos em uso, o Marcos foi reembolsado e o pacote do Lucas venceu. Veja em Pacotes → Vendidos; numa comanda aberta do Carlos ou da Paula, o serviço oferece "Usar sessão de pacote". A Paula vê o saldo em "Meus agendamentos".
- **Histórico de ~5 semanas:** atendimentos concluídos (alguns com produto), faltas com e sem justificativa, cancelamentos e estornos, com as comandas fechadas no dia do atendimento. Caixa (escolha um dia passado), comissões e relatórios ("7 dias", "Este mês", "30 dias") mostram o movimento real do período.
- **Hoje:** agenda com todos os status (agendado, confirmado, em atendimento, concluído, não compareceu, cancelado), comandas aberta, fechada, estornada e avulsa, e uma venda de balcão. Clientes que faltaram sem justificativa aparecem com alerta na ficha do agendamento.
- **Próximos 7 dias:** agenda parcialmente preenchida, com confirmados nos primeiros dias.
- **Cliente online (Paula):** "Meus agendamentos" com atendimentos passados, uma reserva que ela mesma cancelou, uma que ela mesma reagendou e reservas futuras (o botão Reagendar aparece até 24 h antes).
- **Barbearia Vizinha:** outra cor (vinho, sem logo), um cliente, um atendimento de ontem e um de amanhã, para conferir o isolamento.

As datas são relativas ao dia em que o seed rodou, e o sorteio do histórico usa semente fixa
(o mesmo dia gera os mesmos dados). Leva cerca de um minuto. O comando é idempotente: se a demo já
existir, ele **só acrescenta os módulos que ela ainda não tem** (por exemplo, produtos e estoque numa
demo criada antes desse módulo) e nunca sobrescreve o que você personalizou, como cores e logo.
Para recriar tudo com datas atuais, apague o banco local (`docker compose down -v`) e refaça os
passos. O seed se recusa a rodar em produção.

### Migrations e seed depois da primeira instalação

Os comandos abaixo rodam da raiz do repositório, com o banco no ar (`docker compose up -d db`).

**Ver se há migrations pendentes:**

```bash
docker compose run --rm --no-deps backend npx prisma migrate status
```

**Aplicar migrations novas** (por exemplo, depois de um `git pull` que trouxe arquivos novos em `backend/prisma/migrations/`):

```bash
docker compose run --rm --no-deps backend sh -c "npx prisma migrate deploy && npm run db:generate"
docker compose restart backend   # a API precisa recarregar o client do Prisma
```

**Popular com os dados de demonstração** (banco sem a Barbearia Demo, ou demo antiga que ainda não tem os módulos novos; rode depois de aplicar as migrations):

```bash
docker compose run --rm --no-deps backend npm run db:seed
```

**Recriar o banco do zero** (banco com problema, ou demo com datas atuais). ⚠️ Apaga **todos** os dados locais:

```bash
docker compose down -v                # remove os containers e o volume do banco
docker compose up -d --wait db        # recria o banco e espera ficar pronto
docker compose run --rm --no-deps backend sh -c "npx prisma migrate deploy && npm run db:seed"
docker compose up -d
```

> `migrate deploy` só aplica migrations que já existem e nunca apaga dados. Para **criar**
> uma migration nova (mudança no `schema.prisma`), siga [`.claude/rules/database.md`](.claude/rules/database.md).

### Testando a API pelo Swagger

Com a stack no ar, abra **http://localhost:3333/docs**. Todas as rotas estão agrupadas
por área, com descrição, permissões exigidas, erros possíveis e exemplos de corpo
já preenchidos no **Try it out**.

1. **Autenticação → `POST /v1/auth/register-barbershop` → Try it out → Execute.** Troque `slug` e `email` se já existirem.
2. Copie o `accessToken` da resposta, clique em **Authorize** (cadeado no topo) e cole o token. A autorização continua salva ao recarregar a página.
3. Cadastre o básico: o expediente em **Equipe → `PUT /v1/staff/{id}/schedule`** (o `id` é o `profile.membership.id` do passo 1), um serviço e um cliente.
4. Agende em **Agenda → `POST /v1/appointments`** e repita com um horário sobreposto para ver o `409 appointment-conflict`.
5. Abra e feche a comanda em **Comandas** e confira o resultado em **Financeiro → `GET /v1/cash/day`**.

O access token vale 15 minutos: renove com **`POST /v1/auth/refresh`** (o cookie já foi gravado)
e atualize o **Authorize**. Rotas sem cadeado são públicas. O contrato completo também está
em `GET /docs-json` e versionado em [`backend/contracts/openapi.json`](backend/contracts/openapi.json),
para importar no Postman ou no Insomnia. O Swagger não é servido em produção.

### Linux

Os passos acima são os mesmos no Linux. Só a preparação muda:

1. **Instale o Docker Engine e o plugin Compose** pelo repositório oficial da sua distribuição ([guia oficial](https://docs.docker.com/engine/install/)). Em Ubuntu/Debian, depois de configurar o repositório:

   ```bash
   sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin
   ```

   Confira com `docker compose version`. O projeto usa o Compose v2 (`docker compose`, sem hífen).

2. **Rode o Docker sem `sudo`**, colocando seu usuário no grupo `docker`. Depois, saia e entre de novo na sessão (ou rode `newgrp docker`):

   ```bash
   sudo usermod -aG docker "$USER"
   ```

3. **Libere as portas 3000, 3333 e 5432.** Se você já tiver um PostgreSQL instalado na máquina, pare-o (`sudo systemctl stop postgresql`) ou troque a porta publicada do serviço `db` no `docker-compose.yml`.

4. **Siga os passos de [Como rodar localmente](#como-rodar-localmente).**

**Arquivos criados pelos containers ficam com dono `root`.** Os containers rodam como root, então `node_modules/`, `.next/`, `dist/` e o client gerado do Prisma aparecem no seu projeto pertencendo ao root. Se o editor ou o git reclamarem de permissão, devolva a posse ao seu usuário:

```bash
sudo chown -R "$(id -u):$(id -g)" backend frontend
```

No Linux, o hot reload funciona nos dois apps sem configuração extra, porque os eventos de arquivo chegam nativamente aos containers. Os testes e2e do backend (Testcontainers) usam o Docker do host pelo socket `/var/run/docker.sock`, que já vem montado no container.

### Windows

- Use o Docker Desktop com o backend WSL2.
- No Git Bash, prefixe os comandos `docker compose` com `MSYS_NO_PATHCONV=1`.
- O hot reload do frontend não funciona com o projeto numa pasta do Windows: depois de editar, rode `docker compose restart frontend`. Para ter hot reload, mantenha o repositório dentro do sistema de arquivos do WSL2 (veja [`agent_docs/productivity.md`](agent_docs/productivity.md)).

### Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Frontend responde **500** em todas as páginas; o log (`docker compose logs frontend`) mostra `Could not find the Next.js package` ou `build-manifest.json` ausente | `npm ci` rodou com o frontend no ar e apagou o `node_modules` debaixo do servidor | `docker compose stop frontend`, apague `frontend/.next` e rode `docker compose up -d frontend` |
| API não sobe; o log mostra `Variáveis de ambiente inválidas` | `backend/.env` ausente ou com `JWT_ACCESS_SECRET` vazio ou curto | preencha o segredo (mínimo de 32 caracteres) e rode `docker compose up -d backend` |
| `port is already allocated` ao subir | outro serviço usando a porta 3000, 3333 ou 5432 | pare o serviço ou troque a porta publicada no `docker-compose.yml` |
| Mudanças no frontend não aparecem (Windows) | o Turbopack não percebe arquivos alterados em pastas do Windows | `docker compose restart frontend` (veja a seção [Windows](#windows)) |

## Testes e qualidade

```bash
# Backend: unitários + e2e com Postgres real (Testcontainers) e gate de cobertura
docker compose run --rm --no-deps backend npm run test:cov

# Frontend: unitários
docker compose run --rm --no-deps frontend npm test

# Ponta a ponta (Playwright, desktop e celular, com checagem de acessibilidade)
RATE_LIMIT_ENABLED=false docker compose up -d backend frontend
docker compose --profile e2e run --rm --no-deps e2e

# Lint, typecheck e formatação (troque backend por frontend para o outro app)
docker compose run --rm --no-deps backend sh -c "npm run lint && npm run typecheck && npm run format:check"
```

O CI (`.github/workflows/ci.yml`) roda lint, typecheck, testes com cobertura,
build e a checagem de contrato da API em cada pull request.

## Estrutura

```
backend/
  src/modules/     um módulo por domínio: agenda, comandas, financeiro, clientes, equipe…
  src/common/      autenticação, isolamento por tenant, erros (RFC 9457), idempotência
  prisma/          schema, migrations (com RLS e constraints) e bootstrap do banco
  contracts/       contrato OpenAPI versionado
  test/            testes e2e
frontend/
  src/app/painel/  painel da barbearia
  src/app/[slug]/  página pública de agendamento
  src/lib/         cliente da API, sessão e consultas
  e2e/             testes Playwright
agent_docs/        regras de negócio, segurança, arquitetura e fluxo de trabalho
```

## Roadmap

- [x] Agenda integrada, agendamento online, comandas, comissões, caixa e relatórios
- [x] Estoque e venda de produtos
- [x] Pacotes de serviços
- [ ] Lembretes de aniversário (com consentimento)
- [ ] Pagamento online (Pix e cartão)
- [ ] Salários e folha
- [ ] Deploy de produção
