# Segurança

Riscos reais para este stack (NestJS 12 + Next.js 16 + Prisma 7 + PostgreSQL)
em um SaaS multi-tenant que lida com dados pessoais, salários e pagamentos.

## Autenticação

- JWT próprio: **access token curto** (~15 min) e **refresh token rotativo**. O refresh token é guardado como hash no banco, revogado no logout e invalida toda a família de tokens quando há reuso detectado.
- Refresh token vai em cookie `httpOnly`, `Secure`, `SameSite`. Nunca em `localStorage`.
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

## Segredos e variáveis de ambiente

- `.env` nunca é commitado (está no `.gitignore`). Cada app tem um `.env.example` com as chaves, sem valores.
- Segredos de CI ficam em GitHub Actions Secrets. Em produção, use o gerenciador de segredos da plataforma (ainda não definida).
- Valide as env vars na inicialização (`@nestjs/config` + schema) e falhe se faltar alguma.
- Segredos JWT longos e aleatórios, diferentes para access e refresh.

## Supply chain (npm)

- Lockfile commitado. No CI use sempre `npm ci`.
- Em cada app, `.npmrc` com `ignore-scripts=true` (com allowlist para pacotes que precisam de install script) e `min-release-age` de alguns dias, para evitar versões maliciosas publicadas e removidas rapidamente. Confira se a versão do npm em uso suporta essas chaves.
- Dependabot/Renovate ativo. Fixe GitHub Actions de terceiros por SHA, não por tag.
- Antes de adicionar uma dependência nova, confira manutenção, downloads e se ela realmente é necessária.

## Decisões de implementação e riscos residuais (MVP)

- **Rate limit:** `@nestjs/throttler` global (120/min) e mais restrito em auth (10/min) e nas rotas públicas. `RATE_LIMIT_ENABLED=false` existe só para o E2E local; a aplicação **recusa subir** com isso em produção. Atrás de load balancer, configure `TRUST_PROXY_HOPS`, senão todos os clientes dividem o mesmo limite.
- **Privilégios no banco:** o usuário da aplicação não é dono de nada, não lê `_prisma_migrations` e não tem UPDATE/DELETE nos lançamentos financeiros (há teste de regressão).
- **Supply chain na prática:** `min-release-age=3` barrou o `next@16.4.3` (publicado havia menos de 3 dias); usamos o 16.4.2. Pacotes adicionados pelo CLI do shadcn (`cn`) foram verificados (mantenedor, dependência do CLI oficial, sem install scripts). `@hookform/resolvers` foi trocado por um resolver local de 15 linhas.
- **Risco aceito:** cadastrar como funcionário um e-mail que já tem conta revela ao dono da barbearia o nome dessa pessoa. É o custo de permitir que um profissional trabalhe em duas barbearias com uma conta. Alternativa futura: convite por e-mail com aceite.
- **Risco aceito:** o access token continua válido por até 15 min depois de um funcionário ser desativado (o refresh já falha). Se precisar de corte imediato, versionar permissões no token.
- **Pendente para produção:** HTTPS (cookie `Secure` já vale com `NODE_ENV=production`), segredos no gerenciador da plataforma, backups criptografados, `MAIL_PROVIDER=resend` com domínio verificado.
