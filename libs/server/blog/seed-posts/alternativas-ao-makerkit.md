---
slug: alternativas-ao-makerkit
language: pt-BR
translationOf: makerkit-alternatives
title: "Alternativas ao Makerkit: boilerplates SaaS grátis, e quando pagar"
seoTitle: "Alternativas ao Makerkit: boilerplates SaaS grátis e open source"
description: "O Makerkit custa a partir de US$ 299, e o kit Lite grátis não tem cobrança nem equipes. Alternativas grátis que têm os dois, cada fato com fonte, e quando o Makerkit vale o preço."
tldr:
  - Os kits pagos do Makerkit custam US$ 299 ou US$ 599, pagos uma vez; o Lite grátis não tem cobrança, equipes nem admin.
  - Um projeto num kit pago não pode virar open source, e um freelancer precisa de uma licença por cliente.
  - O Seed é grátis e MIT, com equipes, cobrança por membro e app de administração, no seu próprio servidor.
  - Escolha o Makerkit se quiser Supabase, Next.js ou React Router e as ferramentas para agentes de código.
topic: Perguntas
intro: "O Makerkit é um kit pago caprichado com uma edição Lite grátis, e a diferença entre os dois é exatamente o que um produto para equipes precisa. Aqui estão as alternativas grátis que cobrem essa diferença, com fonte para cada fato, e os casos em que pagar o Makerkit é a escolha certa."
relatedFeature: deploy
coverAlt: "Uma grande caixa de ferramentas violeta aberta, com as bandejas cheias, ao lado de uma pequena caixa cinza fechada com cadeado."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

A alternativa grátis ao Makerkit que mantém o que os kits pagos acrescentam, ou seja, equipes,
cobrança e um painel de administração, é o Seed: um boilerplate com licença MIT, com grupos e
papéis, cobrança por membro no Stripe e um app de administração em domínio próprio. O kit grátis do
próprio Makerkit, o Lite, deixa esses três de fora. Para uma base grátis menor há o Next.js SaaS
Starter e, entre os pagos, o Supastarter. Os kits pagos do Makerkit custam US$ 299 ou US$ 599,
pagos uma vez.

Eu desenvolvo o Seed, então leia sabendo disso. Cada fato sobre outro produto tem link para a fonte,
e li cada página em 4 de novembro de 2026. Algo mudou?
[Abra uma issue](https://github.com/spy4x/seed/issues) e eu corrijo.

## O que o Makerkit oferece, e o que falta no Lite?

O [Makerkit](https://makerkit.dev/) tem kits sobre três camadas de dados (Supabase; Drizzle com
Better Auth; Prisma com Better Auth) para Next.js 16, TanStack Start e, com Supabase, React Router
8. A página inicial lista login com senha, link mágico, passkeys opcionais, OAuth e app
autenticador; contas de equipe com papéis e convites; assinaturas no Stripe fixas, por assento ou
por uso; um superadmin que pode entrar como um usuário ou bani-lo; traduções; blog e documentação;
e notificações em tempo real nos kits com Supabase. Para agentes de código, traz regras, skills e um
servidor MCP.

A [página de preços](https://makerkit.dev/pricing) mostra duas licenças de pagamento único, com
atualizações vitalícias:

- **Pro**, US$ 349, US$ 299 nos cards dos kits: um desenvolvedor, projetos ilimitados.
- **Teams**, US$ 649, US$ 599 nos cards: até cinco pessoas no repositório.

Leia os termos antes de comprar, porque dois deles surpreendem. Um freelancer precisa de uma
licença separada para cada cliente. E um projeto feito num kit pago não pode ser publicado como open
source: para isso a página manda para o Lite. Reembolsos em geral não são dados depois do acesso,
por isso a própria página sugere testar o Lite primeiro.

O [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) é grátis e MIT, com
cerca de 470 estrelas no GitHub: Next.js, login com Supabase, páginas de perfil, i18n e páginas de
marketing. O README lista o que fica de fora, e essa lista é o coração de um produto para equipes:
cobrança, contas de equipe, modelos de e-mail, o painel de superadmin, blog e documentação.

## Tabela: o Makerkit e as alternativas lado a lado

| Boilerplate                                                               | Preço                                              | Licença                            | Stack                                   | Equipes e cobrança              | Hospedagem                                |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- | --------------------------------------- | ------------------------------- | ----------------------------------------- |
| [Makerkit](https://makerkit.dev/pricing)                                  | US$ 299 ou 599, uma vez (preço de tabela 349, 649) | Paga, sem open source, por cliente | Next.js, React Router ou TanStack Start | Sim, por assento                | Recomenda Vercel; Cloudflare, Docker, VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | Grátis                                             | MIT                                | Next.js, Supabase                       | Não                             | Não informado                             |
| [Seed](https://github.com/spy4x/seed)                                     | Grátis                                             | MIT                                | Hono, Preact; Postgres                  | Sim, por membro                 | Seu próprio servidor, Docker Compose      |
| [Supastarter](https://supastarter.dev/)                                   | US$ 349, 799 ou 1.499, uma vez                     | Paga, sem redistribuição           | Next.js, Nuxt ou TanStack Start         | Sim, por assento                | Vercel, Docker, Coolify e outros          |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | Grátis                                             | MIT                                | Next.js, Drizzle; Postgres              | Owner e Member; Stripe Checkout | Vercel                                    |

A linha de hospedagem do Makerkit vem do seu
[checklist de produção](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist),
que recomenda a Vercel e avisa que Docker ou VPS pedem "mais configuração". A
[página de comparação](/pt-BR/compare) alinha 19 recursos de seis boilerplates.

## Qual alternativa grátis tem o que falta no Makerkit Lite?

O **Seed** tem as três peças. Cada pessoa ganha um grupo no cadastro, com papéis de leitor, editor,
administrador e dono. O Stripe cobra por membro, com plano grátis, 14 dias de teste e um prazo de
carência depois de um pagamento recusado. Um app de administração em domínio próprio acha uma
pessoa, estorna um pagamento e registra cada ação num log de auditoria. Login com senha, passkeys,
códigos por e-mail, Google e GitHub, e um app autenticador como segundo fator. E soma o que nenhuma
página do Makerkit menciona: um app que abre sem internet e enfileira as alterações, e monitoramento
do servidor (VictoriaMetrics, Grafana) e backups no arquivo Compose. O Stripe [atende empresas do Brasil](https://stripe.com/global), e o Seed já vem em português do Brasil.

Como o Seed é MIT, as duas surpresas da licença não existem: publique seu produto como open source
ou faça dez projetos de clientes em cima dele, e ninguém precisa de uma segunda licença. Eu mesmo
faço os MVPs dos meus clientes sobre o Seed, então não é teoria.

O **Next.js SaaS Starter**, cerca de 16.300 estrelas, fica entre o Lite e os kits pagos: equipes
com Owner e Member, Stripe Checkout e Customer Portal sobre Next.js, Drizzle e Postgres, sem painel
de administração.

## Quanto custa a hospedagem por fora?

O checklist do Makerkit recomenda a Vercel, e o kit principal roda sobre o Supabase. Esse par é
cobrado todo mês, por assento de desenvolvedor e por banco. O Seed roda num único servidor alugado.
Escolha o servidor e o tamanho da equipe:

<HostingCost server="cx23" developers={1} />

Com um desenvolvedor, o Seed no CX23 custa € 12,48 por mês, contra US$ 45 da Vercel Pro com o
Supabase Pro. Não é uma comparação exata: o par gerenciado atualiza, escala e faz backup por você.
Como pôr o Seed num servidor: o [guia de deploy](/pt-BR/docs/deploy).

## Quando vale a pena pagar o Makerkit?

- **Você quer Supabase.** O kit principal do Makerkit se apoia na autenticação, no armazenamento e
  na row-level security dele. O Seed tem o próprio Postgres e o próprio login.
- **Você quer Next.js ou React Router.** O Seed é Preact em tudo, inclusive no site público.
- **Você precisa entrar como um usuário, cobrar por uso ou ter um segundo provedor de pagamento.** O
  Makerkit lista os dois primeiros, e a página inicial cita o Polar ao lado do Stripe. O Seed não
  tem nenhum dos três; o Stripe é o único provedor.
- **Você trabalha com agentes de código.** O Makerkit traz um servidor MCP e skills. O Seed tem
  [instruções para agentes](/pt-BR/docs/ai-agents), mas não tem servidor MCP
  ([#211](https://github.com/spy4x/seed/issues/211)).
- **Você quer um mantenedor com histórico.** O Makerkit diz que é mantido em tempo integral desde
  2022. O Seed é jovem e tem um mantenedor só: eu.

## Como testar o Seed antes de decidir?

Abra a [demo](https://app.seedsaas.com): um clique abre uma conta de convidado com dados de
exemplo, e em dois minutos você cria uma equipe, convida alguém e abre a cobrança. Depois clone
[o repositório](https://github.com/spy4x/seed). E se o Makerkit servir melhor, comece pelo Lite,
como a própria página de preços sugere. Mais opções:
[alternativas ao Supastarter](/pt-BR/blog/alternativas-ao-supastarter).
