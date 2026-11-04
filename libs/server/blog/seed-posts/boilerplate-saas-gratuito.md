---
slug: boilerplate-saas-gratuito
language: pt-BR
translationOf: free-saas-boilerplate
title: Existe boilerplate SaaS gratuito e open source? Sete opções, comparadas sem enrolação
seoTitle: "Boilerplate SaaS gratuito: 7 templates open source"
description: Sim. Seed, Open SaaS, Next.js SaaS Starter, ixartz, Apptension, BoxyHQ e Makerkit Lite são gratuitos e abertos. O que cada um traz, e o que muda para cobrar assinatura no Brasil.
tldr:
  - Sim, há vários boilerplates SaaS gratuitos e open source, com login, pagamentos e painel prontos.
  - As edições grátis de kits pagos costumam deixar de fora justamente pagamentos ou equipes.
  - Stripe funciona no Brasil, mas o Pix Automático não está disponível para empresas sediadas aqui. Assinatura recorrente vai no cartão ou no boleto.
  - Seed traz grupos com papéis, cobrança por membro via Stripe, painel admin e nove idiomas no seu próprio servidor.
topic: Perguntas
intro: "Procurei um boilerplate SaaS gratuito do jeito que você faria e encontrei sete que não custam nada. Cada um deixa algo diferente de fora, então comparei o que você realmente recebe antes de investir seu tempo em um deles."
coverAlt: "Sete mudas em vasinhos numa prateleira de madeira, atrás de um portão de jardim aberto."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Sim: existem vários boilerplates SaaS gratuitos e open source, e os bons já vêm com login,
pagamentos e painel. Em 3 de novembro de 2026, Seed, Open SaaS, o Next.js SaaS Starter da Vercel,
ixartz SaaS Boilerplate, Apptension SaaS Boilerplate, BoxyHQ SaaS Starter Kit e Makerkit Lite estão
sob licença MIT ou Apache-2.0. A diferença está no que cada um deixa de fora.

Eu desenvolvo o Seed, então não sou neutro. Cada informação sobre outro projeto tem o link da
página onde li, em 3 de novembro de 2026, e quando outro template serve melhor para você, eu falo.

## Quais boilerplates SaaS gratuitos existem?

| Template                           | Licença    | Stack                        | Equipes e papéis                    | Pagamentos                     | Onde roda                                          |
| ---------------------------------- | ---------- | ---------------------------- | ----------------------------------- | ------------------------------ | -------------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres | Grupos: leitor, editor, admin, dono | Stripe, por membro             | Docker Compose em qualquer servidor Linux seu      |
| [Open SaaS][opensaas]              | MIT        | Wasp: React, Node.js, Prisma | Não citados                         | Stripe, Polar ou Lemon Squeezy | Fly.io ou Railway com um comando, ou qualquer host |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle   | Owner e Member                      | Stripe                         | Vercel, no guia                                    |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk      | Organizações com papéis, via Clerk  | Não na edição grátis           | Não informado                                      |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres      | Tenants: Owner, Admin, Member       | Stripe                         | AWS, via AWS CDK                                   |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres    | Equipes com papéis                  | Assinaturas Stripe por equipe  | Botões de Vercel, Heroku e DigitalOcean            |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase            | Não no Lite                         | Não no Lite                    | Qualquer host com Next.js                          |

"Não citados" significa que a página do projeto não menciona. Não prova que falta, mas também não
conte com isso.

## Dá para cobrar assinatura no Brasil com esses templates?

Dá, com uma ressalva que os reviews em inglês não contam. O Stripe [atende o Brasil][stripe-global],
e quase todos os kits da tabela cobram via Stripe. Mas, segundo a
[documentação do Pix no Stripe][pix] (lida em 3 de novembro de 2026), contas no Brasil aceitam Pix
só em pagamentos avulsos: o Pix Automático, que é o Pix recorrente, não está disponível para
empresas sediadas no Brasil. Então:

- **Assinatura mensal** de empresa brasileira via Stripe, hoje, é no cartão ou no boleto: a
  [documentação do boleto no Stripe][boleto] (lida em 3 de novembro de 2026) diz que ele funciona
  com assinaturas, para contas no Brasil. Isso vale para o Seed e para qualquer outro kit que use
  Stripe Billing.
- **Empresa fora do Brasil** vendendo para brasileiros pode usar o Pix Automático pelo Stripe, mas o
  cliente paga IOF de 3,5% em compra internacional, diz a mesma página.
- **Gateway nacional** (Asaas, Pagar.me, Mercado Pago) significa trocar o Stripe por outro
  integrador. No Seed o código de cobrança fica concentrado no módulo billing, descrito em
  [docs/billing.md][billing], mas a troca ainda é trabalho de dias.

Sobre a LGPD: kits que rodam no seu servidor (Seed, Open SaaS com deploy manual, BoxyHQ com Docker)
deixam você escolher onde ficam os dados. O ixartz guarda as contas dos usuários no Clerk, um
serviço hospedado; vale colocar isso no seu mapeamento de dados.

## Quando outro template é a melhor escolha?

- **Open SaaS**, se você vende para pessoas físicas e quer Polar ou Lemon Squeezy além do Stripe.
  O preço é adotar o framework Wasp.
- **Next.js SaaS Starter**, se você quer uma base pequena em Next.js, para ler numa tarde.
- **Apptension**, se o time é de Python e Django: login com segundo fator, passkeys, SSO, três
  papéis, Stripe e admin.
- **BoxyHQ**, se você vende para empresas grandes que exigem SAML SSO e SCIM no primeiro dia.
  Também traz assinaturas Stripe por equipe.

## O que o Seed traz?

O Seed é para um produto pago por equipes, num servidor que você controla. No `main` hoje: login
com senha, passkeys, Google, GitHub e link por e-mail, segundo fator por app autenticador, grupos
com quatro papéis e convites, cobrança por membro no Stripe com plano grátis e 14 dias de teste,
painel admin em domínio próprio, armazenamento de arquivos, notificações no app, por web push e no
Telegram, app que funciona offline e nove idiomas, português do Brasil incluído.

Os limites, sem rodeio: só Stripe, servidores em Deno 2 (Node e Bun estão [nos planos][runtime],
sem data), nada de serverless, e um mantenedor só, que sou eu.

## Por onde começar?

Responda duas perguntas: quem paga, uma pessoa ou uma equipe, e como você vai receber, cartão ou
boleto via Stripe, ou outro gateway. A tabela cai para uma ou duas opções. Se for "equipes e Stripe", abra a
[demo](https://app.seedsaas.com) em português, veja a
[comparação com kits pagos](/pt-BR/compare) e comece pelo [repositório][seed].

[seed]: https://github.com/spy4x/seed
[billing]: https://github.com/spy4x/seed/blob/main/docs/billing.md
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
[pix]: https://docs.stripe.com/payments/pix
[boleto]: https://docs.stripe.com/payments/boleto
