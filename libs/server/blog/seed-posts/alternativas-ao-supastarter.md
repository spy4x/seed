---
slug: alternativas-ao-supastarter
language: pt-BR
translationOf: supastarter-alternatives
title: "Alternativas ao Supastarter: boilerplates SaaS grátis e pagos para equipes"
seoTitle: "Alternativas ao Supastarter: boilerplates SaaS para equipes"
description: "O Supastarter custa de US$ 349 a US$ 1.499, pagos uma vez. Alternativas grátis e pagas com organizações e cobrança por assento, cada fato com fonte, e quando ele ainda vale mais."
tldr:
  - O Supastarter é um kit pago para Next.js, Nuxt ou TanStack Start, por US$ 349, US$ 799 ou US$ 1.499, pagos uma vez.
  - O Seed é uma alternativa grátis com licença MIT, com grupos, papéis e cobrança por membro no Stripe.
  - O concorrente pago mais próximo é o Makerkit; o grátis mais enxuto, o Next.js SaaS Starter.
  - Fique com o Supastarter se quiser Vue, outro meio de pagamento além do Stripe ou exemplos de IA.
topic: Perguntas
intro: "O Supastarter é um dos kits SaaS pagos mais completos, com organizações, cobrança por assento e cinco provedores de pagamento. Também custa de US$ 349 a US$ 1.499. Comparei com as alternativas grátis e pagas que também atendem equipes, com uma fonte para cada fato."
relatedFeature: groups
coverAlt: "Um longo barco a remo violeta com muitos remos e assentos vazios, amarrado a um píer onde está atracado um iate cinza com uma etiqueta de preço em branco."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-04T09:00:00Z
newsletter: false
---

As principais alternativas ao Supastarter para um produto vendido a equipes são o Seed, um
boilerplate grátis com licença MIT que já traz grupos, papéis e cobrança por membro no Stripe, e o
Makerkit, um kit pago a partir de US$ 299. Para uma base grátis menor, há o Next.js SaaS Starter e
o Open SaaS, mas neles as equipes ou a cobrança ficam por sua conta. O Supastarter custa US$ 349,
US$ 799 ou US$ 1.499, pagos uma vez, e aceita mais provedores de pagamento que qualquer um deles.

Eu desenvolvo o Seed, então não sou neutro. Por isso cada fato sobre outro produto tem link para a
fonte, li cada página em 4 de novembro de 2026, e há uma seção sobre quando o Supastarter é a
melhor escolha. Algum fato desatualizou? [Abra uma issue](https://github.com/spy4x/seed/issues) e
eu corrijo.

## O que vem no Supastarter?

O [Supastarter](https://supastarter.dev/) é um boilerplate pago para Next.js, Nuxt ou TanStack
Start. A página inicial mostra três preços de pagamento único, com atualizações vitalícias:

- **Solo**, US$ 349: um desenvolvedor, projetos pessoais ilimitados, uso comercial.
- **Startup**, US$ 799: até cinco desenvolvedores, projetos da equipe, uma consultoria de 60
  minutos e suporte prioritário por e-mail.
- **Agency**, US$ 1.499: até dez desenvolvedores, projetos de clientes, white label e um canal
  privado no Discord com o fundador.

Dentro: login com Better Auth (senha, passkeys, link mágico, OAuth e segundo fator); organizações
com convites, papéis e cobrança por assento; Stripe, Lemon Squeezy, Polar, Creem e Dodo Payments;
um superadmin que pode entrar como um usuário; i18n; blog em MDX e documentação; tarefas em segundo
plano com trigger.dev ou QStash; armazenamento S3; Sentry; e um exemplo de chatbot com IA. Prisma ou
Drizzle rodam por padrão sobre PostgreSQL, e a [documentação](https://supastarter.dev/docs/nextjs)
tem guias de deploy para Vercel, Render, Fly.io, Netlify, Docker, Coolify e Railway.

A [licença](https://supastarter.dev/legal/license) permite criar e vender quantos produtos quiser,
para você ou para clientes. Você não pode redistribuir o código nem compartilhar a licença, e um
repositório público precisa da permissão do autor. Não achei política de reembolso nas páginas que
li, então pergunte antes de comprar.

## Tabela: o Supastarter e as alternativas lado a lado

| Boilerplate                                                    | Preço                                     | Licença                  | Stack                                     | Equipes e papéis          | Hospedagem                                |
| -------------------------------------------------------------- | ----------------------------------------- | ------------------------ | ----------------------------------------- | ------------------------- | ----------------------------------------- |
| [Supastarter](https://supastarter.dev/)                        | US$ 349, 799 ou 1.499                     | Paga, sem redistribuição | Next.js, Nuxt ou TanStack Start; Postgres | Sim, cobrança por assento | Vercel, Docker, Coolify e outros          |
| [Seed](https://github.com/spy4x/seed)                          | Grátis                                    | MIT                      | Hono, Preact; Postgres                    | Sim, por membro           | Seu próprio servidor, Docker Compose      |
| [Makerkit](https://makerkit.dev/pricing)                       | US$ 299 ou 599 (preço de tabela 349, 649) | Paga; kit Lite em MIT    | Next.js, React Router ou TanStack Start   | Sim, por assento          | Recomenda Vercel; Cloudflare, Docker, VPS |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) | Grátis                                    | MIT                      | Next.js, Drizzle; Postgres                | Owner e Member            | Vercel                                    |
| [Open SaaS](https://github.com/wasp-lang/open-saas)            | Grátis                                    | MIT                      | Wasp (React, Node.js, Prisma); Postgres   | Não informado             | Railway ou Fly.io, ou qualquer host       |

"Não informado" quer dizer que as páginas do produto não mencionam, não que seja impossível
adicionar. A página de preços do Makerkit risca US$ 349 e 649 e cobra US$ 299 e 599; o FAQ ainda
cita 349 e 649. A [página de comparação](/pt-BR/compare) põe 19 recursos de seis boilerplates numa
tabela.

## Cobrança no Brasil: o que muda na escolha?

O Stripe [atende empresas do Brasil](https://stripe.com/global) (conferido em 4 de novembro de
2026), e é o único meio de cobrança do Seed. Se você já usa o Stripe, Seed, Supastarter e Makerkit
servem. Se precisa de outro provedor hoje, o Supastarter é o que oferece mais: além do Stripe,
Lemon Squeezy, Polar, Creem e Dodo Payments. O Seed também já vem em português do Brasil, no app,
no painel, no site e nos e-mails, entre nove idiomas.

## Existe uma alternativa grátis ao Supastarter com equipes e cobrança?

Existe, e é justamente a lacuna que a maioria dos kits grátis deixa. Eles param no login e no Stripe
Checkout; equipes, papéis e um preço por membro são a parte pela qual você ia pagar o Supastarter.

O **Seed** faz essa parte. Cada pessoa ganha um grupo no cadastro, com papéis de leitor, editor,
administrador e dono, e o Stripe cobra por membro, com plano grátis, 14 dias de teste e um prazo de
carência depois de um pagamento recusado. Login com senha, passkeys, códigos por e-mail, Google e
GitHub, e um app autenticador como segundo fator. Um app de administração em domínio próprio acha
uma pessoa, estorna um pagamento e registra cada ação num log de auditoria. Além do que o
Supastarter lista, o Seed tem atualizações em tempo real por WebSocket, um app que abre sem internet
e enfileira as alterações, e monitoramento do servidor (VictoriaMetrics, Grafana) e backups no
arquivo Compose.

O **Next.js SaaS Starter**, cerca de 16.300 estrelas no GitHub, é o pequeno e honesto: e-mail e
senha, Stripe Checkout, equipes com Owner e Member. Dá para ler numa tarde e construir o resto.

O **Open SaaS**, também com cerca de 16.300 estrelas, traz painel de admin, upload para S3, tarefas
em segundo plano e Stripe, Polar ou Lemon Squeezy, mas o README não menciona equipes.

## Quanto a hospedagem soma?

A licença é paga uma vez; a conta de hospedagem, todo mês. Os guias de deploy do Supastarter
começam pela Vercel, e um Postgres gerenciado como o Supabase é um dos seus guias de banco. O Seed
roda num único servidor alugado. Arraste o controle para comparar Vercel Pro e Supabase Pro com o
Seed num servidor da Hetzner:

<HostingCost server="cx23" developers={1} />

Com um desenvolvedor, o Seed no CX23 custa € 12,48 por mês e o par gerenciado, US$ 45. Como pôr o
Seed num servidor: o [guia de deploy](/pt-BR/docs/deploy). O Supastarter também roda em Docker num
servidor seu: a diferença acima é o preço do caminho gerenciado, não do Supastarter.

## Quando o Supastarter ainda é a melhor escolha?

- **Você escreve Vue.** O Supastarter tem uma edição em Nuxt. O Seed é Preact; o Makerkit, React.
- **Você precisa hoje de outro provedor além do Stripe.** O Supastarter tem cinco. Dois deles,
  [Lemon Squeezy](https://www.lemonsqueezy.com/) e [Polar](https://polar.sh/), se apresentam como
  merchant of record: vendem em seu nome e cuidam dos impostos. O Seed cobra só pelo Stripe; um
  provedor merchant of record é uma ideia em aberto
  ([#584](https://github.com/spy4x/seed/issues/584)), não um plano.
- **Você quer cobrança por uso, entrar como um usuário ou um exemplo de chatbot com IA.** O
  Supastarter lista os três. O Seed não tem nenhum.
- **Você faz deploy na Vercel ou em serverless.** O Seed precisa de um servidor que você controle.
- **Você quer uma consultoria paga e um vendedor que responda.** Startup e Agency incluem uma. O
  Seed tem as issues do GitHub e eu.

E pese os riscos do Seed: é um projeto jovem, com um mantenedor só. A API e o worker rodam em
Deno, Node ou Bun ([documentação](https://github.com/spy4x/seed/blob/main/docs/apps.md)), mas as
tarefas e os testes ainda precisam do Deno.

## Como testar o Seed antes de gastar US$ 349?

Abra a [demo](https://app.seedsaas.com): um clique entra numa conta de convidado com dados de
exemplo, e em dois minutos você cria uma equipe, convida alguém e abre a cobrança. Serviu? Clone
[o repositório](https://github.com/spy4x/seed). Não serviu? O Supastarter é um bom kit, e as
[alternativas ao ShipFast](/pt-BR/blog/alternativas-ao-shipfast) comparam mais sete.
