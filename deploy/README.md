# Deploy de produção

Runbook do TaNaRegua numa VPS com Docker Compose (hoje, Hostinger). Nada aqui depende do
provedor: qualquer Linux com Docker roda as mesmas imagens. Decisões em
`agent_docs/architecture.md` ("Deploy") e `agent_docs/security.md`.

```
Internet ──443──▶ Caddy ─┬─ /api/* ─▶ backend (NestJS)  ─▶ db (Postgres 18, RLS)
                         └─ resto  ─▶ frontend (Next)   ─▶ backend (SSR, rede interna)
backup (diário) ─ pg_dump + logos ─ age ─▶ storage S3-compatível fora da VPS
```

Só o Caddy publica portas (80/443). API, web e banco ficam na rede interna do compose.

## Como uma versão chega à produção

1. O PR entra no `main` com o CI verde.
2. O job `images` do CI publica três imagens no GHCR, com a tag igual ao SHA do commit:
   - `tanaregua-backend`: a API;
   - `tanaregua-migrate`: as migrations;
   - `tanaregua-frontend`: o web.
3. **Actions → Deploy → Run workflow** com o SHA. O workflow copia `deploy/` daquele commit
   para a VPS e roda `deploy.sh <sha>`, que:
   1. baixa as imagens;
   2. roda `prisma migrate deploy` com o dono das tabelas;
   3. sobe tudo e espera os healthchecks.

**Rollback:** rode o Deploy com o SHA anterior; ele fica em `~/tanaregua/.deployed-tag` antes
de cada deploy. Migrations não voltam sozinhas: toda migration precisa funcionar com o código
da versão anterior (adicionar primeiro e remover numa versão seguinte).

## Preparar a VPS (uma vez)

1. **Acesso.** Crie um usuário `deploy` no grupo `docker`. SSH só por chave: `PasswordAuthentication no` e `PermitRootLogin no`. Firewall liberando só 22, 80 e 443.
2. **Docker.** Instale o Docker Engine com o plugin Compose, pelo repositório oficial do Docker para a distribuição.
3. **DNS.** Aponte um registro A/AAAA do domínio da plataforma para o IP da VPS. O Caddy emite o certificado no primeiro acesso.
4. **Chave de deploy.**
   - Gere um par só para o GitHub Actions: `ssh-keygen -t ed25519 -f deploy_key -C github-deploy`.
   - Coloque `deploy_key.pub` no `~/.ssh/authorized_keys` do usuário `deploy`.
   - No GitHub, em **Settings → Environments → production**, cadastre os segredos:
     - `DEPLOY_HOST`;
     - `DEPLOY_USER`;
     - `DEPLOY_SSH_KEY`: o conteúdo de `deploy_key`;
     - `DEPLOY_KNOWN_HOSTS`: a saída de `ssh-keyscan <host>`, conferida com a impressão digital mostrada pela própria VPS.
   - Apague a chave privada do seu computador depois.
5. **Imagens privadas.** Se os pacotes do GHCR forem privados, na VPS rode `docker login ghcr.io -u <usuario>` com um token de acesso pessoal com escopo `read:packages`.
6. **Configuração.** Crie `~/tanaregua/.env` a partir de [`.env.example`](.env.example), com `chmod 600`. Gere os segredos assim:

   ```sh
   openssl rand -hex 32      # DB_OWNER_PASSWORD e APP_DB_PASSWORD (um para cada)
   openssl rand -base64 48   # JWT_ACCESS_SECRET e INTERNAL_API_TOKEN (um para cada)
   openssl rand -base64 32   # SECRETS_ENCRYPTION_KEY (estável; trocar exige reconectar o WhatsApp)
   ```

7. **Backup.**
   - Crie um bucket num storage S3-compatível de outro fornecedor (Cloudflare R2, Backblaze B2, AWS S3…).
   - Crie uma chave de acesso restrita a esse bucket.
   - Gere o par age **no seu computador**, não na VPS: `age-keygen -o tanaregua-backup.key`.
     - A linha `public key: age1...` vai em `BACKUP_AGE_RECIPIENT`.
     - O arquivo `tanaregua-backup.key` fica guardado fora da VPS, num gerenciador de senhas. Sem ele, os backups não abrem.
8. **Primeiro deploy.** Rode o workflow Deploy. O volume do Postgres é criado na primeira subida, e `db-init/` cria o usuário da aplicação com `APP_DB_PASSWORD`. Mudar essa senha depois exige `ALTER ROLE` no banco.

## Operação

```sh
cd ~/tanaregua
docker compose ps                         # estado e healthchecks
docker compose logs -f backend            # logs estruturados (sem PII)
docker compose logs backup                # resultado dos backups
docker compose run --rm backup backup     # backup imediato (ex.: antes de uma migration delicada)
```

### Ensaio de restauração (faça no primeiro deploy e depois a cada trimestre)

Backup que nunca foi restaurado não é backup. Num computador com Docker e com a chave privada,
a partir de uma cópia deste diretório:

```sh
# 1. Baixe um arquivo do bucket (ex.: rclone copy, ou pelo painel do storage) para ./restaurado/
# 2. Suba um Postgres vazio com o mesmo db-init (ele cria o usuário da aplicação):
docker compose -p tnr-ensaio up -d --wait db
# 3. Restaure banco e logos:
docker compose -p tnr-ensaio run --rm --no-deps \
  -v "$PWD/tanaregua-backup.key:/key.txt:ro" -v "$PWD/restaurado:/restore" \
  backup restore /restore/tanaregua-<data>.tar.age /key.txt /restore/storage
# 4. Confira: contagem de barbearias e de comandas bate com a produção do dia do backup.
docker compose -p tnr-ensaio exec db psql -U tanaregua -c 'select count(*) from barbershops'
# 5. Apague o ensaio (dados pessoais): docker compose -p tnr-ensaio down -v && rm -rf restaurado
```

Para restaurar a produção de verdade num servidor novo:
1. Faça o mesmo restore com o projeto padrão.
2. Copie os logos restaurados para o volume `storage`.
3. Rode o deploy.

## Checklist antes do primeiro cliente

- [ ] `MAIL_PROVIDER=resend` com domínio verificado (SPF/DKIM) e `MAIL_FROM` desse domínio
- [ ] Ensaio de restauração feito, com o resultado anotado
- [ ] `https://<domínio>/api/health/ready` respondendo 200
- [ ] Login com 11 senhas erradas seguidas recebe 429 só para quem errou, não para outro IP
