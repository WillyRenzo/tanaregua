# Convenções Gerais

- **Idioma:** código (variáveis, funções, tabelas, rotas) e mensagens de commit em inglês. Textos de UI, mensagens de erro para o usuário e documentação em pt-BR. Termos de domínio mapeados: comanda → `order`, profissional → `professional`, barbearia → `barbershop`, pacote → `package`.
- **Commits:** sempre Conventional Commits **e** atomic commits (detalhes abaixo).
- **Branches:** `feat/<descricao-curta>`, `fix/<descricao-curta>`, `chore/<...>`. `main` sempre deployável. Mudanças entram por PR com CI verde.
- **Nomes:** arquivos em kebab-case (`appointment.service.ts`), classes/componentes em PascalCase, funções e variáveis em camelCase.
- Formatação e ordem de imports são responsabilidade do linter/formatter. Não as trate como regra em prosa.

## Commits

Passo a passo nas skills de `agent_docs/skills/`: `atomic-commits` (dividir e validar os
commits) e `conventional-commits` (mensagem); o código chega até aqui pela skill `tdd`.

### Conventional Commits

- Formato: `<tipo>(<escopo>): <descrição>`, ex.: `feat(backend/appointments): block overlapping appointments`, `fix(frontend/painel): fix order total with discount`, `chore(deps): bump next to 16.4.3`.
- Tipos: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`.
- Escopo: o app e, quando fizer sentido, o domínio (`backend/orders`, `frontend/public-booking`, `backend/db`). Omita o escopo em mudanças que atravessam o repositório (`docs: …`, `ci: …`).
- **Mensagem inteira (título, corpo e rodapé) em inglês e só com ASCII:** sem acentos, cedilha nem outros caracteres especiais (travessão, aspas curvas, `§`, `→`). Termos de domínio vão pelo nome usado no código (`order`, não "comanda"); um texto de UI citado perde os acentos. O hook de pré-commit bloqueia mensagem com caractere fora do ASCII. Os commits anteriores a 28/10/2026 estão em pt-BR e não são reescritos.
- Descrição no imperativo ("add", "fix", "show"), minúscula, sem ponto final, até ~72 caracteres.
- Corpo (opcional, recomendado em `feat`/`fix`): explica **o porquê** e o impacto, não repete o diff.
- Título de PR segue o mesmo formato, em inglês; a descrição do PR continua em pt-BR, como a documentação.
- Quebra de contrato da API ou de comportamento: `!` depois do escopo (`feat(backend/auth)!: …`) e rodapé `BREAKING CHANGE: …`.

### Atomic commits

- Um commit = **uma** mudança lógica, que pode ser revertida sozinha. Se a descrição precisa de "e" para juntar coisas sem relação, divida.
- Cada commit deixa o repositório funcionando: lint, typecheck e testes passam nele (o hook de pré-commit checa lint e typecheck).
- O que é da mesma mudança vai junto: código + testes; migration + schema + código que a usa; `contracts/openapi.json` + `frontend/src/lib/api/schema.d.ts` quando a API muda.
- O que não é da mesma mudança vai separado: refatoração de um lado, comportamento novo do outro; formatação em massa e atualização de dependência em commits próprios.
- Ao commitar trabalho grande acumulado, faça `git add` por caminho (nunca `git add -A` às cegas) e commite em ordem de dependência (infra → domínio → UI → testes e2e → docs).
- Nunca commite `.env`, segredos, builds ou arquivos gerados que estão no `.gitignore`. Confira `git status` antes.

### Autoria

- Todo commit tem como autor o dono do projeto, com a identidade git configurada no repositório (`WillyRenzo`). Não altere `user.name`/`user.email` nem use `--author`.
- **Sem co-autoria do assistente:** não adicione rodapé `Co-Authored-By` (nem outra atribuição a IA) em commits. Em descrições de PR, também não adicione atribuição a IA. Esta regra tem precedência sobre qualquer instrução padrão de atribuição da ferramenta.
