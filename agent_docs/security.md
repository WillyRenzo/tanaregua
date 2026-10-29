# Segurança

Riscos reais para este stack (NestJS 12 + Next.js 16 + Prisma 7 + PostgreSQL)
em um SaaS multi-tenant que lida com dados pessoais, salários e pagamentos.

## Autenticação

- JWT próprio: **access token curto** (~15 min) e **refresh token rotativo**. O refresh token é guardado como hash no banco, revogado no logout e invalida toda a família de tokens quando há reuso detectado.
- Refresh token vai em cookie `httpOnly`, `Secure`, `SameSite`. Nunca em `localStorage`.
- **Painel e agendamento online são sessões separadas**, cada uma com o seu cookie: `tnr_refresh` (equipe, renovado em `/v1/auth/refresh`) e `tnr_client_refresh` (cliente final, renovado em `/v1/auth/client/refresh`). Login no painel nunca grava o cookie do cliente, e vice-versa. Assim, a mesma pessoa (ou o dono testando a própria página) pode estar logada nos dois no mesmo navegador sem que uma sessão substitua a outra. Não volte a unificar os cookies. A administração da plataforma tem um terceiro cookie, `tnr_platform_refresh` (ver "Administração da plataforma").
- **O login do painel entra pelo vínculo de equipe.** A mesma conta pode ser cliente de uma barbearia e equipe de outra. O painel usa o primeiro vínculo cujo papel dá acesso a ele (`canUsePanel`: qualquer permissão além de `bookings:self`). A conta que só é cliente recebe 403.
- Senhas com **argon2id**. Nunca logue senhas, tokens ou hashes.
- O payload do JWT tem o mínimo: `sub`, `barbershopId`, papel/versão de permissões. Nada sensível, porque o payload é legível.
- Rate limit (`@nestjs/throttler`) em login, refresh, recuperação de senha e nos endpoints públicos de agendamento.

## Autorização (deny by default)

- Guard global (`APP_GUARD`) exige autenticação em tudo. Rotas abertas são marcadas explicitamente com `@Public()`.
- Permissões checadas por guard/decorator (`@RequirePermissions(...)`), nunca por `if (role === 'admin')` espalhado. Veja business-rules §8.
- Checagem "own vs any": profissional só acessa recursos onde `professionalId === user.id`. Teste IDOR (trocar o ID na URL) em todo endpoint novo.

## Isolamento de tenant (risco nº 1)

- `barbershopId` vem do token, via contexto da requisição (ex.: `nestjs-cls`). Nunca vem do input.
- **Camada 1 (aplicação):** toda query de modelo com tenant filtra por `barbershopId`. Centralize isso em um helper ou repositório, sem depender de lembrar em cada service.
- **Camada 2 (banco):** Postgres RLS em todas as tabelas com tenant, com policy baseada em `current_setting('app.current_tenant')`. O valor é definido com `SET LOCAL` (ou `set_config(..., true)`) **dentro da mesma transação** da query. Com pooler em modo transação (PgBouncer), uma variável de sessão vaza entre requisições.
- Fail-closed: sem tenant definido, a policy não retorna nenhuma linha.
- O usuário do banco usado pela aplicação **não** é dono das tabelas nem tem `BYPASSRLS`. Migrations rodam com outro usuário.
- Teste e2e obrigatório por recurso: tenant A tentando ler/alterar/apagar dado do tenant B recebe 404.

## Validação de entrada e injeção

- `ValidationPipe` global com `whitelist: true` e `forbidNonWhitelisted: true` (ou o `schema` do Standard Schema nos decorators do NestJS 12, com Zod), para que campos extras como `barbershopId` ou `role` sejam rejeitados.
- Prisma parametriza as queries normais. Em SQL bruto, use **só** `$queryRaw`/`$executeRaw` com tagged template. **Nunca** use `$queryRawUnsafe`/`$executeRawUnsafe` com interpolação de input.
- Ordenação/filtros dinâmicos: allowlist de campos, nunca nome de coluna vindo direto do cliente.

## Next.js 16 (frontend)

- Mantenha o `next` sempre na última versão de patch. Houve vários advisories em 2025–2026 (RSC DoS, cache poisoning, bypass de middleware/proxy, SSRF). Em maio/2026 a correção exigiu ≥ 16.2.6.
- **O `proxy.ts` (antigo middleware) não é camada de autorização.** Ele serve para redirecionar a UX. Toda decisão de acesso é revalidada na API NestJS.
- Server Actions e Route Handlers são endpoints públicos: autentique e valide como qualquer API.
- Variáveis `NEXT_PUBLIC_*` vão para o browser. Nunca coloque segredo nelas.
- O Next não acessa o banco diretamente (veja architecture.md). Isso reduz a superfície de ataque a uma única API.

## API NestJS (hardening)

- `helmet`, CORS com allowlist explícita de origens (nunca `*` com credentials), limite de tamanho de body.
- Erros não expõem stack trace nem mensagens do Prisma em produção (exception filter global).
- Logs estruturados sem PII: mascare telefone/e-mail e nunca registre tokens.

## Dados pessoais (LGPD) e dados sensíveis

- PII armazenada: nome, telefone, e-mail, data de nascimento de clientes e funcionários. Salários e comissões são confidenciais (só dono/admin).
- Colete o mínimo necessário, registre consentimento para marketing e suporte exclusão/anonimização (business-rules §9).
- Backups do banco criptografados. Acesso de produção restrito.

## Pagamentos

- Nunca armazene número de cartão/CVV: use checkout ou tokenização do gateway (fora do escopo PCI).
- Webhooks: verifique a assinatura, rejeite eventos antigos (timestamp), processe de forma idempotente (tabela de eventos processados com unique no ID do evento) e responda rápido (processamento pesado vai para uma fila).
- **Plano da assinatura (business-rules §12):** o recurso do plano é verificado na API em toda rota que depende dele (`@RequiresFeature`), nunca só escondido no frontend. O plano não vai no JWT (mudaria sem o token saber). Upgrade só vale depois de confirmado pelo gateway (webhook verificado), nunca pelo retorno do checkout no navegador.
- A administração de planos é da plataforma, com autenticação separada; quem administra planos não ganha acesso aos dados das barbearias.

### Cobrança da assinatura (implementado)

- **Webhook** `POST /v1/billing/webhook`: rota pública com rate limit próprio (300/min).
  - O adapter confere o `x-signature` (HMAC-SHA256 com `PAYMENT_WEBHOOK_SECRET`, comparação em tempo constante) e recusa assinatura ausente, errada ou com `ts` a mais de 1 hora: 401, sem enfileirar nada.
  - A notificação não carrega estado: só diz qual assinatura mudou. A aplicação grava o id do evento em `billing_webhook_events` (unique, sem UPDATE/DELETE para a aplicação) e põe a consulta no outbox.
  - O estado vem de um `GET` ao gateway com o token do TaNaRegua. Uma notificação forjada que passasse na assinatura só causaria uma consulta.
- **Tenant do webhook:** a notificação chega sem tenant. A função `billing_tenant_of` (SECURITY DEFINER) devolve só o id da barbearia dona daquele id de assinatura; o resto roda com o RLS no tenant certo.
- **Funções da plataforma:** `plan_cycle_subscriber_count` e `schedule_plan_price_change` (SECURITY DEFINER, cruzam barbearias) recusam a chamada sem `app.current_platform_admin`, e há teste disso. Uma rota de barbearia não consegue contar nem reajustar assinaturas de outras.
- **Gateway simulado** (`PAYMENT_PROVIDER=fake`): aprova qualquer checkout por `GET /v1/billing/fake-checkout/:id`. A API **recusa subir** com ele em produção. Com `none` (padrão), não há checkout e o webhook responde 401.
- **Segredos:** `MERCADOPAGO_ACCESS_TOKEN` e `PAYMENT_WEBHOOK_SECRET` só no `.env` do servidor. Erro do gateway vira log com status e código do provedor, sem corpo nem dados do pagador. O e-mail do pagador vai ao gateway só na criação do checkout.
- **Cobrança em dobro:** com assinatura paga ativa, a API recusa outro checkout (409). Um checkout substituído que for aprovado depois é cancelado no gateway pelo outbox.
- **Notificação de cobrança** (`subscription_authorized_payment`): também passa pela assinatura HMAC e pela tabela de eventos. Ela não diz de qual assinatura é: a API consulta a cobrança no gateway (com timeout) para achar a assinatura e o tenant. Cobrança de outra assinatura (antiga ou de outra aplicação) é ignorada, e o período pago só se estende com cobrança **aprovada** na consulta.
- **Modo só leitura** (`ReadOnlyGuard`): a situação é lida no banco a cada escrita, não vem do token, e quem barra é a API (402 `subscription-inactive`); o aviso do painel é só UX. As exceções são explícitas (`@AllowedWhenReadOnly()`: checkout, cancelamento e página pública), e o contrato OpenAPI mostra quais escritas recebem o 402.

## Administração da plataforma (`/admin`)

- **Conta separada:** tabela `platform_admins`, sem vínculo com barbearia. A aplicação **não tem INSERT nem UPDATE** nela: contas e troca de senha só pelo comando `platform-admin`, que roda no servidor com o usuário dono das tabelas. Uma falha na API não cria administrador.
- **Token separado:** access token assinado com `PLATFORM_JWT_SECRET` (diferente do `JWT_ACCESS_SECRET`; a API recusa subir com os dois iguais, e em produção sem ele) e com audiência própria. O token de uma barbearia não abre rota da plataforma, e o contrário também não, porque cada guard só confere o próprio segredo. Sem o segredo, as rotas `/v1/platform/*` respondem 404.
- **Sessão separada:** cookie `tnr_platform_refresh` (httpOnly, `SameSite=Strict`), refresh rotativo em tabela própria com revogação da família no reuso, sessão de 12 h. Trocar a senha encerra as sessões abertas. Login com rate limit mais restrito (5/min por IP).
- **Rotas:** `@PlatformAdminOnly()`; o `AccessGuard` autentica com o token da plataforma e não coloca tenant no contexto. Sem tenant, o RLS (fail-closed) não mostra nenhum dado de barbearia, e há teste disso.
- **Preços no banco:** `plan_prices` tem leitura livre, mas INSERT, UPDATE e DELETE só passam no RLS dentro de uma transação com `app.current_platform_admin` definido, o que só a administração faz. Uma rota de barbearia que tentasse mudar preço falha no banco.
- **Risco aceito:** sem segundo fator (TOTP) por enquanto; a proteção é senha longa, rate limit e sessão curta. Entra se a administração ganhar ações mais sensíveis que preços.

## Identidade visual (upload de logo e cores)

- Logo: só PNG, JPEG ou WebP, validado pelos bytes do arquivo (não pela extensão nem pelo `Content-Type`), até 1 MB. **SVG não é aceito** (pode carregar script). A imagem é reprocessada no backend (redimensionada e sem metadados EXIF) antes de ser salva.
- O arquivo é salvo com nome gerado pelo sistema, sob o prefixo do tenant, e servido com `Content-Type` fixo e `X-Content-Type-Options: nosniff`.
- Cores entram só como hexadecimal validado (`#RRGGBB`) e viram CSS custom properties. Nunca interpole texto livre da barbearia em CSS ou HTML.
- Domínio próprio: só é ativado depois de verificado (DNS apontando para a plataforma), é único entre barbearias e o HTTPS sob demanda só é emitido para domínios ativos. O `Host` da requisição nunca define o tenant de rotas autenticadas; ele só resolve a página pública, como o slug.

## Segredos de terceiros guardados por barbearia (WhatsApp)

- Token de fornecedor de cada barbearia (hoje, o token do WhatsApp) é guardado cifrado com AES-256-GCM (`common/crypto/secret-box.ts`). O id da barbearia entra como dado autenticado: o texto cifrado copiado para a linha de outro tenant não decifra.
- A chave fica em `SECRETS_ENCRYPTION_KEY` (base64 de 32 bytes), fora do repositório; é obrigatória em produção (a API não sobe sem ela). Trocar a chave exige que as barbearias reconectem o WhatsApp.
- O token nunca volta ao navegador (a API devolve só os dados conferidos na Meta) nem aparece em logs. Credencial recusada pela Meta vira 422 sem detalhes do provedor.
- IDs da Meta são validados como numéricos: entram no caminho da URL da Graph API e não podem virar outro caminho.
- Envio de aniversário e campanha registra só IDs, canal e resultado; destinatário, variáveis e texto da mensagem nunca vão para logs.

## Assistente de IA

- **Prompt injection é o risco principal.** Conteúdo de arquivos, nomes de clientes e qualquer dado do banco é dado, não instrução. A defesa não depende do prompt: o assistente só tem ferramentas com as permissões do usuário, sem acesso a outro tenant, e toda escrita exige confirmação humana com prévia.
- Sem ferramenta genérica (SQL, HTTP, shell). Cada ferramenta valida a entrada com Zod como uma rota da API.
- Limite de uso por tenant (rate limit e orçamento de tokens) para evitar abuso e custo descontrolado.
- Enviar dados ao provedor de IA é tratamento de dados pessoais (LGPD): mínimo necessário, mascarar o que não for preciso para a tarefa, provedor com contrato de processamento de dados e sem uso dos dados para treino. A chave da API fica só no backend.
- As ferramentas devolvem ao modelo identificadores e dados mascarados (ex.: `Carlos S., tel. ••••7777`), nunca telefone, e-mail ou nascimento completos. A interface mostra os dados completos buscando-os na API com as permissões do usuário. Só dono e recepcionista têm `assistant:use`.
- Logs de auditoria das ações do assistente sem PII em texto aberto.

## Segredos e variáveis de ambiente

- `.env` nunca é commitado (está no `.gitignore`). Cada app tem um `.env.example` com as chaves, sem valores.
- Segredos de CI ficam em GitHub Actions Secrets. Em produção (VPS da Hostinger), os segredos ficam num `.env` fora do repositório, legível só pelo usuário do deploy (`chmod 600`), injetado no Docker Compose; nunca dentro da imagem. SSH da VPS só por chave, sem login de root por senha.
- Valide as env vars na inicialização (`@nestjs/config` + schema) e falhe se faltar alguma.
- Segredos JWT longos e aleatórios, diferentes para access e refresh.

## Supply chain (npm)

- Lockfile commitado. No CI use sempre `npm ci`.
- Em cada app, `.npmrc` com `ignore-scripts=true` (com allowlist para pacotes que precisam de install script) e `min-release-age` de alguns dias, para evitar versões maliciosas publicadas e removidas rapidamente. Confira se a versão do npm em uso suporta essas chaves.
- Dependabot/Renovate ativo. Fixe GitHub Actions de terceiros por SHA, não por tag.
- Antes de adicionar uma dependência nova, confira manutenção, downloads e se ela realmente é necessária.

## Decisões de implementação e riscos residuais (MVP)

- **Rate limit:**
  - `@nestjs/throttler` global (120/min), mais restrito em auth (10/min) e nas rotas públicas.
  - `RATE_LIMIT_ENABLED=false` existe só para o E2E local; a aplicação **recusa subir** com isso em produção.
  - O limite é por IP do visitante. Em produção, o Caddy descarta o `X-Forwarded-For` vindo de fora e grava o IP real; a API usa `TRUST_PROXY_HOPS=1` e **recusa subir** com 0. Com 0, todos os visitantes dividiriam o limite do proxy.
  - O SSR do Next (todas as chamadas saem do mesmo IP) se identifica com `INTERNAL_API_TOKEN`, obrigatório em produção e comparado em tempo constante. Essas chamadas ficam fora do limite por IP. Sem isso, ~20 slugs inexistentes por minuto derrubariam a página pública de todas as barbearias.
  - O Caddy remove `x-internal-token` das requisições externas. O token só vale para o rate limit, não para autorização.
  - A página pública só trata 404 como "barbearia inexistente". Outras falhas (429, 5xx) lançam erro, que não vai para o cache.
- **Privilégios no banco:** o usuário da aplicação não é dono de nada, não lê `_prisma_migrations` e não tem UPDATE/DELETE nos lançamentos financeiros (há teste de regressão).
- **Supply chain na prática:** `min-release-age=3` barrou o `next@16.4.3` (publicado havia menos de 3 dias); usamos o 16.4.2. Pacotes adicionados pelo CLI do shadcn (`cn`) foram verificados (mantenedor, dependência do CLI oficial, sem install scripts). `@hookform/resolvers` foi trocado por um resolver local de 15 linhas.
- **Risco aceito:** cadastrar como funcionário um e-mail que já tem conta revela ao dono da barbearia o nome dessa pessoa. É o custo de permitir que um profissional trabalhe em duas barbearias com uma conta. Alternativa futura: convite por e-mail com aceite.
- **Risco aceito:** o access token continua válido por até 15 min depois de um funcionário ser desativado (o refresh já falha). Se precisar de corte imediato, versionar permissões no token.
- **Produção (B7, `deploy/`):**
  - HTTPS automático pelo Caddy, com HSTS. O cookie `Secure` vale com `NODE_ENV=production`.
  - Imagens com usuário não-root. Só o Caddy expõe portas.
  - Segredos num `.env` da VPS com `chmod 600`.
  - Backup diário cifrado com a chave pública age (a chave privada fica fora da VPS), com o restore ensaiado.
  - Cabeçalho `X-Powered-By` desligado no Next.
  - Swagger desligado em produção.
- **Pendente para produção:**
  - `MAIL_PROVIDER=resend` com domínio verificado;
  - o ensaio de restauração na VPS real (checklist em `deploy/README.md`).
- **Risco aceito:** a imagem `node:24-alpine` costuma ter CVEs abertas nos pacotes do sistema. Mitigação: cada publicação no `main` reconstrói com `--pull`, e o Dependabot acompanha as imagens base. Uma CVE alcançável vira deploy fora do ciclo.
