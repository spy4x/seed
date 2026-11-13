---
slug: alternativas-ao-nextjs-saas-starter
language: pt-BR
translationOf: nextjs-saas-starter-alternatives
title: "Alternativas ao Next.js SaaS Starter: o que usar quando ele fica pequeno"
seoTitle: "Alternativas ao Next.js SaaS Starter, grátis e pagas"
description: "O Next.js SaaS Starter é grátis e pequeno de propósito: sem redefinir senha nem e-mail de convite. Alternativas com mais coisa pronta, grátis e pagas."
tldr:
  - O Next.js SaaS Starter é grátis e MIT, com times de dono e membro e Stripe Checkout.
  - Ele não envia nenhum e-mail, então convites, redefinição de senha e verificação ficam com você.
  - Grátis e com tudo isso pronto é o Seed; para ficar no Next.js com mais coisa pronta, Makerkit ou Supastarter.
  - Fique com o starter se quer um código pequeno para aprender ou fazer o login do seu jeito.
topic: Perguntas
intro: "O Next.js SaaS Starter é uma base limpa e pequena, e o próprio README diz que é para aprender. Veja o que falta nele e qual template escolher quando você precisa dessas partes prontas."
relatedFeature: sign-in
coverAlt: "Uma pequena armação de madeira em volta de uma única muda, na frente de uma estufa de vidro pronta e cheia de plantas violeta."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

O Next.js SaaS Starter é um template grátis com licença MIT: login com e-mail e senha, Stripe
Checkout e times com papéis de dono e membro. O README dele o chama de minimalista de propósito, um
recurso para aprender. As alternativas servem quando você quer mais coisa pronta: o Seed é grátis
e MIT, com convites, redefinição de senha, passkeys e cobrança por membro, e o Makerkit e o
Supastarter são templates pagos que mantêm você no Next.js.

Eu faço o Seed, leve isso em conta. Cada fato sobre outro produto tem link para a fonte, e conferi
todos em 4 de novembro de 2026. Algo desatualizado?
[Abra uma issue](https://github.com/spy4x/seed/issues) que eu corrijo.

## O que vem no Next.js SaaS Starter?

O [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) fica na organização do Next.js no
GitHub, e a maioria dos commits é de Lee Robinson. Tem cerca de 16.250 estrelas. O README lista:

- uma landing page e uma página de preços que abre o Stripe Checkout;
- login com e-mail e senha, com JWT em cookies;
- um painel com times e papéis de dono e membro;
- gestão da assinatura no Customer Portal do Stripe;
- um log de atividade dos usuários.

O stack é Next.js, Postgres com Drizzle e shadcn/ui. Dá para ler tudo numa tarde, e a ideia é
essa.

## O que falta nele?

Ele não envia e-mail. O `package.json` não tem biblioteca de e-mail, e convidar um membro salva o
convite mas não manda nada; o código diz isso:
[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454).
Redefinição de senha e verificação de e-mail também não existem no código.

O login é só e-mail e senha: sem Google, sem GitHub, sem passkeys, sem segundo fator.

A cobrança é uma assinatura por time. O Checkout começa com quantidade um e 14 dias de teste, e a
quantidade só muda se alguém editar no Customer Portal
([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). Entrar um
membro novo não muda a fatura.

E ele anda devagar. Os dois últimos commits, de 8 e 11 de dezembro de 2025, foram atualizações de
segurança do Next.js; o segundo passou para o Next.js `15.6.0-canary.59` pela correção da
CVE-2025-55182. O anterior a eles foi em junho de 2025.

Nada disso é defeito para o que o template diz ser. Só quer dizer que o que um time pagante precisa
primeiro continua sendo trabalho seu.

## As alternativas lado a lado

| Recurso           | Next.js SaaS Starter | Seed                           | Open SaaS                    | Makerkit                                   | Supastarter                             |
| ----------------- | -------------------- | ------------------------------ | ---------------------------- | ------------------------------------------ | --------------------------------------- |
| Preço             | Grátis               | Grátis                         | Grátis                       | US$ 299 ou US$ 599, pagamento único        | De US$ 349 a US$ 1.499, pagamento único |
| Licença           | MIT                  | MIT                            | MIT                          | Paga; o kit Lite é MIT                     | Paga                                    |
| Stack             | Next.js, Drizzle     | Hono, Preact; Postgres         | Wasp (React, Node.js)        | Next.js 16 ou TanStack Start, entre outros | Next.js, Nuxt ou TanStack Start         |
| Times e papéis    | Dono e membro        | De leitor a dono               | Não                          | Sim, com convites                          | Sim, com convites                       |
| E-mail de convite | Não é enviado        | Sim                            | Sem times                    | Não verifiquei                             | Não verifiquei                          |
| Cobrança          | Stripe, uma por time | Stripe, por membro             | Stripe, Polar, Lemon Squeezy | Não verifiquei                             | Stripe, Lemon Squeezy e mais três       |
| Hospedagem        | Vercel               | Docker Compose no seu servidor | Fly.io ou Railway            | Não verifiquei                             | Vercel, serverless ou Docker            |

Fontes: [Next.js SaaS Starter](https://github.com/nextjs/saas-starter),
[Open SaaS](https://github.com/wasp-lang/open-saas),
[preços do Makerkit](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) e o
[README do Seed](https://github.com/spy4x/seed). Os preços do Makerkit são os com desconto; os de
tabela são US$ 349 e US$ 649. "Não verifiquei" quer dizer que não achei nas páginas que li, não que
falte.

## Qual alternativa escolher?

**Você quer ficar no Next.js com mais coisa pronta.** Pague o Makerkit ou o Supastarter. Os dois
têm organizações com convites e papéis; o Supastarter cobra por assento e oferece cinco provedores
de pagamento. O Makerkit Lite é grátis e MIT, mas sem times nem cobrança.

**Você quer grátis e com os times prontos.** Isso é o Seed. Toda conta vem com um grupo, com papéis
de leitor a dono; os convites saem por e-mail; o Stripe cobra por membro e a quantidade acompanha o
número de membros, com plano grátis, 14 dias de teste e carência depois de um pagamento que falhou.
O login também está pronto: senha com código de confirmação, passkeys, Google, GitHub, códigos por
e-mail, contas de convidado e um app autenticador como segundo fator
([login no Seed](/pt-BR/features/sign-in)). Some um app admin com auditoria, tempo real, um app
offline e nove idiomas. O preço: não é Next.js, e sim Hono e Preact.

**Você vende para pessoas individuais e gosta de um framework fazendo a cola.** Veja o Open SaaS;
também escrevi sobre [as alternativas a ele](/pt-BR/blog/alternativas-ao-open-saas).

## Quanto custa a hospedagem: Vercel ou um servidor?

O README do template faz deploy na Vercel e aceita qualquer URL de Postgres. O Seed roda num
servidor que você aluga. Aqui estão os dois, com Vercel Pro e Supabase Pro como um par gerenciado
comum; escolha um servidor e mexa no controle para o seu time:

<HostingCost server="cx23" developers={1} />

Com um desenvolvedor, o Seed num Hetzner CX23 custa € 12,48 por mês e o par gerenciado US$ 45,
cerca de € 40,12 pelo câmbio do BCE de 2 de novembro de 2026. Não é comparar igual com igual: o
gerenciado poupa você de atualizar servidor, e outra pessoa faz o backup do banco. A conta
completa, com cada preço e sua fonte, está em
[deploy de um SaaS num servidor Hetzner](/blog/deploy-saas-to-one-hetzner-server) (em inglês).

## Quando o Next.js SaaS Starter ainda é a melhor escolha?

- Você quer aprender App Router e Server Actions num código que dá para ler inteiro.
- Você vai fazer login e cobrança do seu jeito e quer apagar o mínimo possível.
- Seu time conhece Next.js e React, e você faz deploy na Vercel.

Os riscos do Seed, para pesar: é novo e tem um mantenedor só. A API e o worker também rodam em
Node ou Bun com uma linha no arquivo env
([sobre o runtime](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), mas o site e as
ferramentas ainda precisam do Deno.

## Como testo o Seed antes de decidir?

Abra a [demo ao vivo](https://app.seedsaas.com): um clique e você está numa conta de convidado com
dados de exemplo. Convide um colega e abra a cobrança, exatamente o que o template do Next.js deixa
para você. Se servir, clone [o repositório](https://github.com/spy4x/seed). Para uma visão mais
ampla, [alternativas ao ShipFast](/pt-BR/blog/alternativas-ao-shipfast) compara sete templates
numa tabela.
