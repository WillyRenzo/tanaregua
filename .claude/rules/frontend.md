---
paths:
  - "frontend/**/*.ts"
  - "frontend/**/*.tsx"
---
# Frontend (Next.js 16 App Router)

- Server Components por padrão; `"use client"` só onde há interatividade, o mais baixo possível na árvore.
- Dados vêm **só** da API NestJS, pelo cliente tipado `src/lib/api/client.ts` (gerado do contrato: `npm run api:generate`). No painel, use os hooks de `src/lib/queries.ts`; em Server Components, `src/lib/api/server.ts`. Nada de `fetch` solto.
- **Cache Components está ligado:** dado dinâmico (params, searchParams, `usePathname`, cookies) precisa de `<Suspense>`. Rodar `npx next build` é o que pega esses erros; o typecheck não pega.
- Páginas do painel exportam `export const instant = false` (são bloqueadas por sessão no cliente). Página nova no painel? Copie o padrão.
- `proxy.ts` só redireciona a UX; não é controle de acesso.
- Erros da API chegam como `ApiError` com `code` (o fim do `type` do Problem Details): trate casos específicos pelo `code` (`appointment-conflict`, `slot-unavailable`…) e mostre `userMessage` no resto.
- Dinheiro em centavos (`formatMoney`, `MoneyInput`); datas sempre no fuso da barbearia (`formatTime`, `localInstant`, nunca o fuso do navegador).
- Não use APIs que só existem em contexto seguro (ex.: `crypto.randomUUID`) sem fallback: em HTTP fora do localhost elas não existem (veja `idempotencyKey`).
- Formulários: react-hook-form + `zodResolver` local (`src/lib/forms/zod-resolver.ts`), com campos via `<Field>` (label, erro e ARIA ligados).
- Visual: tokens em `globals.css` (direção "barbearia clássica/industrial"). Status sempre com ícone + texto. Gráficos seguem a skill dataviz (`components/charts.tsx`); cor de gráfico nova precisa passar no validador da skill nos dois modos.
- Componentes shadcn em `components/ui/` são nossos: corrija-os quando o axe acusar algo (ex.: contraste das abas).
- Testes: Vitest + Testing Library (`*.test.ts(x)`), Playwright em `e2e/` (use `open()` das fixtures: espera a hidratação).
