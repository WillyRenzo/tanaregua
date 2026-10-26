# Convenções Gerais

- **Idioma:** código (variáveis, funções, tabelas, rotas) em inglês. Textos de UI, mensagens de erro para o usuário e documentação em pt-BR. Termos de domínio mapeados: comanda → `order`, profissional → `professional`, barbearia → `barbershop`, pacote → `package`.
- **Commits:** Conventional Commits com escopo do app/domínio, ex.: `feat(backend/appointments): bloqueia conflito de horário`, `fix(frontend): ...`, `chore(deps): ...`.
- **Branches:** `feat/<descricao-curta>`, `fix/<descricao-curta>`, `chore/<...>`. `main` sempre deployável. Mudanças entram por PR com CI verde.
- **Nomes:** arquivos em kebab-case (`appointment.service.ts`), classes/componentes em PascalCase, funções e variáveis em camelCase.
- Formatação e ordem de imports são responsabilidade do linter/formatter. Não as trate como regra em prosa.
