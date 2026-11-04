---
slug: alternativas-ao-open-saas
language: pt-BR
translationOf: open-saas-alternatives
title: "Alternativas ao Open SaaS: quando o template grátis do Wasp não serve"
seoTitle: "Alternativas ao Open SaaS (Wasp): templates SaaS grátis e pagos"
description: "O Open SaaS é grátis, MIT e feito com Wasp, mas não tem times. Se você vende para equipes ou quer código simples no seu servidor, estas são as alternativas."
tldr:
  - O Open SaaS é grátis e MIT, com pagamentos, painel admin e upload de arquivos, feito com Wasp.
  - Ele não tem times nem organizações, então cada assinatura é de uma pessoa só.
  - Para vender a equipes, veja o Seed (grátis, MIT) ou os pagos Makerkit e Supastarter.
  - Fique com o Open SaaS se o produto é comprado por pessoas sozinhas, se quer deploy com um comando ou Polar e Paddle.
topic: Perguntas
intro: "O Open SaaS é um dos melhores templates SaaS grátis, sério. Mas ele decide duas coisas por você: uma assinatura por pessoa e o framework Wasp. Veja o que usar se uma delas não combina com você."
relatedFeature: groups
coverAlt: "Uma estufa de vidro com uma grande jardineira compartilhada de plantas violeta dentro e uma fileira de cinco vasinhos ao lado da porta aberta."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

O Open SaaS é um dos templates SaaS grátis mais completos: licença MIT, cerca de 16.250 estrelas
no GitHub, com pagamentos, painel admin e upload de arquivos prontos. Você precisa de uma
alternativa em três casos: vende para equipes (o Open SaaS não tem organizações), prefere não
construir em cima do framework Wasp ou quer rodar tudo no seu próprio servidor. Aí vale olhar o
Seed (grátis, MIT, com times e cobrança por membro) ou os pagos Makerkit e Supastarter.

Eu faço o Seed, então não sou neutro. Cada fato sobre outro produto tem link para a fonte, e
conferi todos em 4 de novembro de 2026. Algo desatualizado?
[Abra uma issue](https://github.com/spy4x/seed/issues) que eu corrijo.

## O que o Open SaaS entrega?

O [Open SaaS](https://github.com/wasp-lang/open-saas) é um template grátis do time que faz o
framework Wasp. O README traz bastante coisa por zero reais:

- cadastro por e-mail com verificação, e Google, GitHub e Discord prontos para ligar na
  [configuração de login](https://github.com/wasp-lang/open-saas/blob/main/template/app/src/auth/auth.wasp.ts);
- pagamentos com Stripe, Polar ou Lemon Squeezy, e o código também tem integração com Paddle;
- painel admin em shadcn/ui, upload de arquivos para AWS S3 e e-mail via SendGrid, Mailgun ou SMTP;
- Plausible ou Google Analytics, um app de demonstração com OpenAI, site de documentação e blog em
  Astro, e testes end-to-end com Playwright;
- regras, skills e um plugin do Claude Code para agentes de IA.

E ele está vivo: o último commit é de 28 de outubro de 2026.

O que falta são times. O
[schema do banco](https://github.com/wasp-lang/open-saas/blob/main/template/app/schema.prisma) tem
um `User` com um campo `isAdmin` e nenhum modelo de time ou organização, então a assinatura
pertence a uma pessoa. Para uma ferramenta que cada um compra para si, é exatamente o certo. Para
um produto B2B, times, convites, papéis e cobrança por assento são suas primeiras semanas de
trabalho.

## O que significa construir em cima do Wasp?

O Wasp é um framework full-stack: você descreve páginas, rotas, login, jobs e operações de
servidor num único arquivo, `main.wasp.ts`, e o Wasp monta o app em React, Node.js e Prisma
([documentação do Wasp](https://wasp.sh/docs)). Ele elimina muito código de cola, e é para isso
que existe.

Em troca, seu app ganha o formato do framework. Você aprende a especificação dele, atualiza quando
ele atualiza, e o Wasp ainda não chegou à 1.0: a última versão é a
[0.26.1, de 23 de outubro de 2026](https://github.com/wasp-lang/wasp/releases). Muita gente acha
que vale a pena. Só aceite isso de propósito, não por acaso.

O deploy é fácil: `wasp deploy` sobe banco, servidor e cliente no Fly.io ou no Railway com um
comando, e o caminho manual serve para qualquer hospedagem
([guia de deploy](https://docs.opensaas.sh/guides/deploying/)). O guia não menciona Docker.

## As alternativas lado a lado

| Recurso        | Open SaaS                        | Seed                                    | Makerkit                                   | Supastarter                             |
| -------------- | -------------------------------- | --------------------------------------- | ------------------------------------------ | --------------------------------------- |
| Preço          | Grátis                           | Grátis                                  | US$ 299 ou US$ 599, pagamento único        | De US$ 349 a US$ 1.499, pagamento único |
| Licença        | MIT                              | MIT                                     | Paga; o kit Lite é MIT                     | Paga                                    |
| Stack          | Wasp (React, Node.js, Prisma)    | Hono, Preact; Postgres                  | Next.js 16 ou TanStack Start, entre outros | Next.js, Nuxt ou TanStack Start         |
| Times e papéis | Não                              | Sim, de leitor a dono                   | Sim, com convites e permissões             | Sim, com convites e papéis              |
| Pagamentos     | Stripe, Polar, Lemon Squeezy     | Stripe, por membro                      | Não verifiquei                             | Stripe, Lemon Squeezy e mais três       |
| Admin          | Painel admin                     | App próprio em outro domínio, auditoria | Não no kit Lite                            | Não verifiquei                          |
| Hospedagem     | Fly.io ou Railway com um comando | Docker Compose no seu servidor          | Não verifiquei                             | Vercel, serverless ou Docker            |

Fontes: [README do Open SaaS](https://github.com/wasp-lang/open-saas),
[preços do Makerkit](https://makerkit.dev/pricing), [Supastarter](https://supastarter.dev/) e o
[README do Seed](https://github.com/spy4x/seed). Os preços do Makerkit são os com desconto; os de
tabela são US$ 349 e US$ 649. "Não verifiquei" quer dizer que não achei nas páginas que li, não
que o produto não tenha.

## Qual alternativa serve para um produto de equipes?

Foi exatamente para isso que fiz o Seed. Cada pessoa ganha um grupo no cadastro, os grupos têm
papéis de leitor a dono e convites por e-mail, e o Stripe cobra por membro: a quantidade acompanha
o número de membros, com plano grátis, 14 dias de teste e um período de carência depois de um
pagamento que falhou
([documentação de cobrança](https://github.com/spy4x/seed/blob/main/docs/billing.md)). A
[página de grupos](/pt-BR/features/groups) mostra como funciona.

O resto da base também está pronto:

- login com senha, passkey, Google, GitHub ou código por e-mail, contas de convidado e um app
  autenticador como segundo fator;
- um app admin no próprio domínio, onde cada ação vai para um log de auditoria;
- atualizações em tempo real por WebSocket e um app que abre e guarda alterações offline;
- armazenamento de arquivos, nove idiomas com árabe da direita para a esquerda, e backups e
  monitoramento no arquivo do Compose.

É TypeScript comum em Hono e Preact, sem arquivo de especificação nem gerador de código entre você
e o código. Roda com Docker Compose num servidor que você aluga, então a conta é um valor fixo por
mês.

Entre os pagos, o **Makerkit** e o **Supastarter** têm organizações com convites e papéis, e o
Supastarter cobra por assento. O irmão grátis, Makerkit Lite, não tem times nem cobrança.

## Quando o Open SaaS é a melhor escolha?

- Você vende para pessoas individuais e quer pagamentos, painel e upload, grátis, hoje.
- Você gosta do modelo do Wasp: um arquivo de especificação e muito menos código de cola.
- Você quer Polar, Lemon Squeezy ou Paddle. O Seed cobra só pelo Stripe; um provedor merchant of
  record é uma ideia aberta ([#584](https://github.com/spy4x/seed/issues/584)), não um plano.
- Você quer deploy com um comando no Fly.io ou Railway, sem servidor para cuidar.
- Você quer uma comunidade grande: o Wasp tem [Discord](https://discord.gg/rzdnErX), e o Open SaaS tem muito mais estrelas no
  GitHub que o Seed.

Os riscos do Seed, para pesar com honestidade: é um projeto novo, com um mantenedor só. A API e o
worker também rodam em Node ou Bun com uma linha no arquivo env
([sobre o runtime](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), mas o site e as
ferramentas ainda precisam do Deno. Os apps para Android e desktop
[ainda não existem](https://github.com/spy4x/seed/issues/202).

## Como comparo os dois numa tarde?

1. Crie um app Open SaaS com `wasp new -t saas`, como diz o README dele.
2. Abra a [demo ao vivo](https://app.seedsaas.com) do Seed: um clique e você está numa conta de
   convidado com dados de exemplo.
3. Nos dois, teste o que seus clientes vão fazer no primeiro dia. Se eles chegam em equipe,
   convide um colega e abra a cobrança.

Minhas outras comparações: [alternativas ao ShipFast](/pt-BR/blog/alternativas-ao-shipfast)
coloca sete templates numa tabela, e
[o guia de boilerplate SaaS gratuito](/pt-BR/blog/boilerplate-saas-gratuito) explica o que um
template grátis já deveria ter. Se o Seed servir, [o repositório](https://github.com/spy4x/seed)
está a um clone de distância.
