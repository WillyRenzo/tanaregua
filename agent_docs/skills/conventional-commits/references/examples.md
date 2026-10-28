# Conventional Commits Examples

Real messages from this repository.

## Feature With Body

```
feat(backend/packages): adiciona pacotes de serviços vendidos na comanda

Pacote com sessões por serviço, preço e validade em dias. É vendido como
item da comanda (cliente identificado) e cada sessão paga um serviço numa
comanda futura do mesmo cliente, consumida só no fechamento.

- saldo garantido no banco: movimentações append-only aplicadas por
  trigger, CHECK de 0 até o comprado, sem UPDATE/DELETE para o app
- reembolso dentro da validade, até o valor pago, com motivo, como saída
  no caixa (exige orders:void)
```

## Bug Fix With Body

```
fix(frontend/brand): aplica a cor principal no fundo do menu

O menu do painel e a barra do topo da página pública ficavam sempre no
marrom TaNaRegua, mesmo com as cores da barbearia configuradas. Agora o
fundo usa a cor principal, escurecida só o necessário para que até o
texto claro a 70% de opacidade mantenha contraste AA.
```

## Short Titles

```
feat(backend/seed): adiciona pacotes à demo de desenvolvimento
feat(frontend/public-booking): mostra o saldo dos pacotes em meus agendamentos
feat(frontend/agenda): adiciona visões de semana e mês e filtro por profissional
docs: documenta as regras e garantias dos pacotes de serviços
chore: adiciona as skills de tdd e de commits
```

## Breaking Change

```
feat(backend/auth)!: exige escopo de barbearia no refresh token

BREAKING CHANGE: tokens emitidos antes deste deploy deixam de renovar;
o usuário precisa entrar de novo.
```

## Heredoc

```bash
git commit -F - <<'EOF'
fix(backend/orders): impede fechar comanda sem itens

A comanda vazia gerava lançamento de R$ 0 no caixa e poluía o relatório.
EOF
```
