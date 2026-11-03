---
slug: alternativas-ao-shipfast
language: pt-BR
translationOf: shipfast-alternatives
title: "Alternativas ao ShipFast: 7 boilerplates SaaS grátis e pagos"
seoTitle: "Alternativas ao ShipFast: 7 boilerplates SaaS comparados"
description: Procurando uma alternativa ao ShipFast que não cobre em dólar? Sete templates SaaS comparados por preço, licença, stack, times e hospedagem, com a fonte de cada dado.
tldr:
  - O ShipFast custa de 199 a 299 dólares em pagamento único e serve bem a produtos de um usuário só.
  - De graça e com licença MIT existem Seed, Open SaaS, ShipFree e o Next.js SaaS Starter.
  - Se quem paga é uma equipe, escolha um template com grupos, papéis e cobrança por membro.
  - O Seed já vem em português do Brasil, e o servidor custa um valor fixo por mês.
topic: Perguntas
author: Anton Shubin
publishAt: 2026-11-02T09:00:00Z
newsletter: false
---

As principais alternativas ao ShipFast são templates gratuitos com licença MIT (Seed, Open SaaS,
ShipFree, o Next.js SaaS Starter e o SaaS Boilerplate do Ixartz) e kits pagos mais caros (Makerkit
e Supastarter). Qual deles é melhor que o ShipFast depende de uma pergunta: quem paga o seu produto
é uma pessoa ou uma equipe? O ShipFast foi feito para o primeiro caso; os outros diferem no quanto
já trazem pronto para o segundo.

Eu desenvolvo o Seed, um dos sete, então não sou neutro. Por isso cada dado sobre outro produto tem
o link da página de onde veio, e há uma seção sobre quando o ShipFast é a melhor escolha. Li todas
as páginas em 3 de novembro de 2026. Algum dado ficou desatualizado?
[Abra uma issue](https://github.com/spy4x/seed/issues) que eu corrijo.

## O que vem no ShipFast?

O ShipFast é um boilerplate de Next.js criado por Marc Lou. A [página de vendas](https://shipfa.st/)
mostra 199 dólares pelo Starter e 249 pelo All-in, em pagamento único, e 299 com o curso CodeFast.
Vem com login por Google ou link mágico (NextAuth), MongoDB ou Supabase, cobrança por Stripe ou
Lemon Squeezy, e-mail por Mailgun ou Resend, um blog e recursos de SEO.

A [licença](https://shipfa.st/license) permite projetos ilimitados, inclusive comerciais, mas
proíbe revender ou redistribuir o template, e o código continua sendo do ShipFast. Ela não fala de
código aberto: pergunte antes de publicar no GitHub um produto feito com ele.

O que a página não cita: grupos ou organizações, papéis, segundo fator, passkeys, painel de
administração e traduções. Numa ferramenta que uma pessoa só assina, talvez nada disso faça falta.
Num produto B2B, é o primeiro mês de trabalho.

## Tabela: ShipFast e as alternativas lado a lado

| Template                                                              | Preço                               | Licença                  | Stack                                   | Times e papéis               | Hospedagem                            |
| --------------------------------------------------------------------- | ----------------------------------- | ------------------------ | --------------------------------------- | ---------------------------- | ------------------------------------- |
| [ShipFast](https://shipfa.st/)                                        | US$ 199 ou 249, pagamento único     | Paga, sem redistribuição | Next.js; MongoDB ou Supabase            | Não citados                  | Vercel como opção gratuita            |
| [Seed](https://github.com/spy4x/seed)                                 | Grátis                              | MIT                      | Deno, Hono, Fresh, Preact; Postgres     | Sim, com cobrança por membro | Um servidor Linux seu, Docker Compose |
| [Open SaaS](https://github.com/wasp-lang/open-saas)                   | Grátis                              | MIT                      | Wasp (React, Node.js, Prisma); Postgres | Não citados                  | Railway ou Fly.io com um comando      |
| [ShipFree](https://github.com/revokslab/shipfree)                     | Grátis                              | MIT                      | Next.js, Bun, Drizzle; Postgres         | Não citados                  | Vercel ou Docker                      |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)        | Grátis                              | MIT                      | Next.js, Drizzle; Postgres              | Owner e Member               | Vercel                                |
| [Ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) | Grátis; versões pagas               | MIT (versão grátis)      | Next.js, Clerk, Drizzle                 | Sim                          | Não cita; Node.js 24+                 |
| [Makerkit](https://makerkit.dev/pricing)                              | US$ 299 ou 599, pagamento único     | Paga; Lite é MIT         | Next.js, React Router ou TanStack Start | Sim                          | Não cita                              |
| [Supastarter](https://supastarter.dev/)                               | De US$ 349 a 1.499, pagamento único | Paga                     | Next.js, Nuxt ou TanStack Start         | Sim, cobrança por assento    | Vercel, serverless ou Docker          |

"Não citados" quer dizer que as páginas do produto não falam disso, não que seja impossível
adicionar. Os preços do Makerkit são os com desconto; sem desconto, 349 e 649 dólares. A versão
grátis do Ixartz não tem Stripe: pagamentos vêm nas versões Pro e Max, que são pagas.

## Quanto custa de verdade para quem ganha em reais?

Um template pago em dólar entra na fatura do cartão internacional com câmbio e impostos do dia, e
os kits mais completos passam de 300 dólares. Os templates grátis da tabela custam zero de licença;
o custo passa a ser o seu tempo.

Com o Seed, o resto da conta também é previsível: tudo roda num servidor que você aluga, com
Postgres, armazenamento de arquivos e monitoramento no mesmo Docker Compose. Você paga um valor
fixo por mês ao provedor, não uma fatura que cresce com o tráfego, como em serverless. O Stripe
atende empresas do [Brasil](https://stripe.com/global), e é o único meio de cobrança do Seed.

O idioma também conta: o Seed já vem em português do Brasil, no app, no painel, no site e nos
e-mails, ao lado de outros oito idiomas. A página do ShipFast não anuncia traduções.

## Qual alternativa grátis se parece mais com o ShipFast?

**ShipFree** é a cópia mais direta da ideia: um kit grátis de Next.js que se apresenta como
alternativa ao ShipFast, hoje com Bun, Drizzle e Better Auth, Stripe e mais cinco provedores de
pagamento. Cerca de 1.700 estrelas no GitHub.

**Open SaaS** é o template grátis mais popular aqui, com cerca de 16.200 estrelas. Usa o framework
Wasp e traz painel de administração, upload de arquivos para S3, Stripe, Polar ou Lemon Squeezy e
um site de documentação.

**O Next.js SaaS Starter**, também com cerca de 16.200 estrelas, é pequeno de propósito: login por
e-mail, Stripe Checkout e times com os papéis Owner e Member. Dá para ler numa tarde.

## E se os seus clientes forem equipes?

É aqui que o Seed é mais forte. Cada pessoa ganha um grupo ao se cadastrar, os grupos têm papéis de
leitor a dono, e o Stripe cobra por membro, então o preço acompanha o tamanho da equipe. O login
está pronto: senha, passkeys, link por e-mail, Google e GitHub, e um app autenticador como segundo
fator. O painel de administração, em domínio próprio, encontra uma pessoa, estorna um pagamento e
registra cada ação num log de auditoria. O app funciona offline e atualiza em tempo real.

O Seed é grátis e MIT: você pode vender, fazer fork ou abrir o código do que construir. A
[tabela comparativa completa](/pt-BR/compare) mostra 19 recursos em seis templates. Entre os kits
pagos, **Supastarter** e **Makerkit** também têm organizações.

## Quando o ShipFast ainda é a melhor escolha?

- Você trabalha com Next.js e React e quer continuar nesse ecossistema.
- Vende para usuários individuais e quer landing page, pagamento e blog no ar neste fim de semana.
- Quer uma comunidade grande: o Discord (mais de 5.000 makers, segundo a página) e o curso fazem
  parte da compra.
- Precisa do Lemon Squeezy hoje. O Seed só cobra pelo Stripe; um provedor merchant of record é uma
  ideia em aberto ([#584](https://github.com/spy4x/seed/issues/584)), não um plano.
- Faz deploy na Vercel ou em funções serverless. O Seed precisa de um servidor que você controle.

E os riscos do Seed, sem enfeite: é um projeto novo, com um único mantenedor, e hoje roda em Deno;
o suporte a Node.js e Bun ainda está por vir.

## Como decidir em dez minutos

1. Anote quem paga: uma pessoa ou uma equipe com administrador.
2. Se for equipe, risque da tabela tudo o que não tem grupos e papéis.
3. Some o custo em reais: licença, servidor e serviços por mês.
4. Abra a demo ou o repositório e faça o cadastro antes de gastar um centavo.

A demo do Seed é o app que você recebe no primeiro dia, com pessoas e dados inventados:
[teste em app.seedsaas.com](https://app.seedsaas.com) e depois veja
[quanto custa colocar no ar](/pt-BR/pricing).
