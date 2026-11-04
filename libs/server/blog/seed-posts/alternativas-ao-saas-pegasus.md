---
slug: alternativas-ao-saas-pegasus
language: pt-BR
translationOf: saas-pegasus-alternatives
title: "Alternativas ao SaaS Pegasus: boilerplates SaaS grátis em Python e TypeScript"
seoTitle: "Alternativas ao SaaS Pegasus: boilerplates SaaS grátis"
description: "O SaaS Pegasus custa US$ 449 ou 649. Duas alternativas grátis, Cookiecutter Django e Seed, e o que muda com Stripe e Pix no Brasil."
tldr:
  - O SaaS Pegasus é um boilerplate Django pago, US$ 449 por um projeto ou US$ 649 sem limite.
  - De graça e em Python, há o Cookiecutter Django, mas sem times nem cobrança.
  - O Seed é grátis (MIT), com times, cobrança via Stripe e painel admin, em TypeScript.
  - Os dois cobram só via Stripe, e uma empresa no Brasil não tem Pix recorrente no Stripe.
topic: Perguntas
intro: "O SaaS Pegasus é um bom starter Django, e custa US$ 449 ou mais. Se você prefere não pagar nada, aqui estão os caminhos gratuitos em Python e em TypeScript, e o que cada um deixa de fora."
coverAlt: "Uma balança com um baú de tesouro trancado e uma etiqueta de preço em branco de um lado, e dois pacotes de sementes abertos do outro."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Para quem procura uma alternativa grátis ao SaaS Pegasus, são dois caminhos: o Cookiecutter Django,
se você quer continuar no Python, e o Seed, se TypeScript serve. O Cookiecutter Django traz
cadastro, Celery e Docker, mas não traz times nem cobrança. O Seed, com licença MIT, já vem com
times e papéis, cobrança por membro no Stripe e um painel admin separado. O Pegasus custa US$ 449
por um projeto ou US$ 649 por projetos ilimitados, pagamento único.

Transparência: quem faz o Seed sou eu. Por isso cada fato sobre outro produto tem fonte, e conferi
tudo em 3 de novembro de 2026.

## O que vem no SaaS Pegasus?

O [SaaS Pegasus](https://www.saaspegasus.com/) é um boilerplate Django que você monta no site dele e
baixa pronto. Pelas [notas de versão](https://docs.saaspegasus.com/release-notes/), ele usa Django
6.0 e Python 3.14, e a versão 2026.10.2 saiu em outubro de 2026.

A [página inicial](https://www.saaspegasus.com/) lista times com convites e papéis, autenticação em
dois fatores, login social, assinaturas Stripe por assento ou por uso, tarefas com Celery, o admin
do Django com "entrar como usuário", o CMS Wagtail, APIs REST, websockets e exemplos de chat e
agentes de IA. O frontend é HTMX ou React com Tailwind.

Os [preços](https://www.saaspegasus.com/pricing/) são em dólar e sem assinatura:

- **Open Source**, grátis: uma base Django com contas e ferramentas. Sem times, sem Stripe, sem
  suporte.
- **Professional**, US$ 449: um projeto e mais um ano de atualizações.
- **Unlimited**, US$ 649: quantos projetos quiser.

A [licença](https://www.saaspegasus.com/license/) permite produto comercial fechado, mas não permite
publicar nem distribuir o código sem autorização do autor.

## Comparação: Pegasus, Cookiecutter Django e Seed

|                     | SaaS Pegasus                                                | Cookiecutter Django    | Seed                                                 |
| ------------------- | ----------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Preço               | US$ 449 ou 649, uma vez                                     | Grátis                 | Grátis                                               |
| Licença             | Paga, sem publicar o código                                 | BSD-3-Clause           | MIT                                                  |
| Linguagem           | Python, Django                                              | Python, Django         | TypeScript, Deno                                     |
| Times com papéis    | Sim                                                         | Não citado             | Sim, de leitor a dono                                |
| Cobrança            | Stripe, por assento ou por uso                              | Não citado             | Stripe, por membro, 14 dias de teste                 |
| Passkeys            | Não aparece na documentação                                 | Não citado             | Sim                                                  |
| Admin               | Admin do Django                                             | Admin do Django        | App próprio em domínio próprio, com log de auditoria |
| Offline             | Não citado                                                  | Não citado             | Sim, guarda as edições até voltar a rede             |
| Português do Brasil | Mecanismo existe, nem todo texto marcado                    | Não citado             | Pronto, junto com outros oito idiomas                |
| Hospedagem          | Render, Fly, Heroku e outros, ou servidor próprio com Kamal | Docker Compose, Heroku | Docker Compose no seu servidor                       |

Fontes: [página do Pegasus](https://www.saaspegasus.com/), [guia de deploy](https://docs.saaspegasus.com/deployment/overview/), [tradução no Pegasus](https://docs.saaspegasus.com/internationalization/), [README do Cookiecutter Django](https://github.com/cookiecutter/cookiecutter-django) e [README do Seed](https://github.com/spy4x/seed).
"Não aparece na documentação": busquei "passkey" e "WebAuthn" em
[toda a documentação do Pegasus](https://docs.saaspegasus.com/llms-full.txt) e não achei nada.
"Não citado": a página do produto não menciona.

## Stripe e Pix: o detalhe que pega quem vende no Brasil

Pegasus e Seed cobram só via Stripe, e o Stripe [atende empresas do Brasil](https://stripe.com/global).
Mas leia a [página do Pix no Stripe](https://docs.stripe.com/payments/pix) antes de prometer Pix
na assinatura: o Pix Automático, que é o Pix recorrente, não está disponível para empresas
sediadas no Brasil. Uma conta Stripe brasileira aceita Pix avulso, em reais; na assinatura, o
cliente paga por outro meio que o Stripe aceite, como cartão.

Isso vale para os dois boilerplates. Se o seu público só paga de Pix, você vai escrever a
integração com outro provedor. No Seed, o Stripe entra pela interface `BillingProvider` do pacote
`@spy4x/billing`, e o app só guarda o que os webhooks informam
([como funciona a cobrança](https://seedsaas.com/docs/billing)); times, papéis e limites do plano
continuam iguais.

## Dá para continuar no Python sem pagar?

Dá, com o [Cookiecutter Django](https://github.com/cookiecutter/cookiecutter-django): licença BSD,
Django 6.0, Python 3.14, cadastro via django-allauth, Celery, Postgres, Docker Compose e 100% de
cobertura de testes desde o começo. Mais de 13 mil estrelas e commit na véspera da minha
verificação.

O que falta é a parte SaaS: times, papéis, convites e cobrança, justamente o que o Pegasus vende.
Reserve algumas semanas para isso.

## Quando o Seed é a melhor escolha?

Quando TypeScript não é problema e você não quer reescrever a base de um SaaS. O Seed junta o que
eu reescrevia em todo MVP de cliente:

- login por senha, passkey, Google, GitHub ou link por e-mail, conta de convidado e segundo fator
  com app autenticador;
- grupos com convites e papéis, o primeiro criado no cadastro;
- cobrança por membro com plano grátis, 14 dias de teste e carência depois de um pagamento que
  falhou;
- painel admin em domínio próprio, com cada ação no log de auditoria;
- tempo real por WebSocket e um app que abre sem internet;
- backups com restic e monitoramento no mesmo Compose.

A stack é Deno, Hono, Preact e Postgres, com deploy por Docker Compose num servidor que você
aluga. A [página de comparação](/pt-BR/compare) coloca o Seed ao lado de ShipFast, Supastarter,
Makerkit e outros starters JavaScript.

## Quando ficar com o SaaS Pegasus?

Em três casos o Pegasus é a melhor escolha, sem discussão:

- **Seu time programa em Python.** Trocar de linguagem custa mais que US$ 449.
- **Você quer IA pronta.** O Pegasus traz chat com LLM, agentes e chamadas de ferramentas; o Seed,
  nada disso.
- **Você quer suporte pago.** O Pegasus tem comunidade e suporte prioritário no Unlimited; o Seed
  tem issues no GitHub e a mim.

Também faltam no Seed cobrança por uso, entrar como um usuário para ver o que ele vê e um CMS de
páginas como o Wagtail. Os apps de Android e desktop [ainda não existem](https://github.com/spy4x/seed/issues/202).

## Teste antes de decidir

Abra a [demo](https://app.seedsaas.com): um clique e você entra como convidado, com dados de
exemplo. Em dois minutos dá para criar um time, convidar alguém e abrir a cobrança. Se servir,
clone [o repositório](https://github.com/spy4x/seed). Se não, compre o Pegasus sem culpa: ele
devolve o dinheiro em até 7 dias.
