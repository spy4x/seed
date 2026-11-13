---
slug: overengineering-boilerplate-saas
language: pt-BR
translationOf: over-engineering-a-saas-boilerplate
title: "O que eu errei no Seed v1: overengineering num boilerplate SaaS"
seoTitle: "Overengineering num boilerplate SaaS: o que eu errei"
description: "O Seed v1 cumpriu metade do roadmap e quase nada do que uma pessoa usa. Como o overengineering de um boilerplate SaaS aparecia no código, e o que o Seed faz agora."
tldr:
  - "O Seed v1 (2019 a 2022) marcou 33 dos 66 itens do roadmap, e nenhum dos 17 do cliente web, do painel de administração, da PWA e do upload de arquivos."
  - "Ele tinha 31 projetos Nx, 23 classes de mensagem CQRS e nove serviços de nuvem em volta de três tabelas."
  - "Overengineering é construir uma funcionalidade de um jeito mais complicado do que ela precisa. Não é construir funcionalidades demais."
  - "O Seed de hoje constrói cada funcionalidade de ponta a ponta num único formato copiado, num só servidor, e tem todas as funcionalidades de produto que o v1 só planejou."
topic: Cicatrizes
intro: "O Seed teve uma primeira versão, de 2019 a 2022, e eu exagerei na engenharia. É assim que isso aparecia no roadmap, nos commits e nas pastas, e é isto que o Seed faz diferente agora."
relatedFeature: deploy
coverAlt: "Um andaime roxo alto montado em volta de uma muda minúscula num vaso, ao lado de um vaso simples onde uma planta grande cresce sozinha."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

O que eu errei no Seed v1? Overengineering: montei o andaime de um produto grande antes de existir
o produto. O próprio roadmap mostra isso. De 66 itens, 33 estavam marcados, e essa metade era
quase toda ferramenta e encanamento de backend: um monorepo, regras de lint rígidas, um hook de
pre-commit, classes base de CQRS, deploys no Google Cloud. Na outra metade ficou quase tudo o que
uma pessoa usa: grupos, pagamentos, atualizações em tempo real, uso offline, upload de arquivos e o
painel de administração.

Este post é para quem está construindo o próprio boilerplate SaaS, ou o primeiro SaaS, e desconfia
que está polindo a oficina em vez de fazer os móveis. Cada número abaixo vem do código: o v1
continua no repositório como a tag [`v1-final`](https://github.com/spy4x/seed/tree/v1-final), e os
comandos que usei para contar estão no [pull request](https://github.com/spy4x/seed/pull/823) que
adicionou este post. Nenhuma lembrança foi ferida: eu só contei.

## O que era o Seed v1?

Um "full-stack startup monorepo template", nas palavras do README, com boas práticas desde o
primeiro dia. Angular no frontend, Nest.js e Prisma sobre PostgreSQL no backend, Firebase para o
login, Google Cloud para rodar, Nx para segurar tudo junto e Yarn para instalar. O primeiro commit
é de 16 de junho de 2019 e o último de 23 de dezembro de 2022: 134 commits em três anos e meio.

Ele não foi minguando. Ele parou: 55 desses commits vieram nos últimos dois meses, e depois nada,
até o Seed recomeçar com um histórico novo em 26 de janeiro de 2026.

## O que o roadmap prometia, e o que foi construído?

O roadmap do README marcava cada item como feito ou planejado. A última atualização foi em 25 de
novembro de 2022:

| Seção do roadmap                               |  Feito | Planejado |
| ---------------------------------------------- | -----: | --------: |
| Ambiente e organização do código               |      8 |         7 |
| Backend                                        |     14 |         5 |
| Banco de dados                                 |      3 |         1 |
| Frontend compartilhado (login, estado, testes) |      6 |         3 |
| Estilos                                        |      2 |         0 |
| PWA (offline, push, instalável)                |      0 |         4 |
| Upload de arquivos                             |      0 |         4 |
| Painel de administração                        |      0 |         3 |
| Cliente web (grupos, tempo real, conta)        |      0 |         6 |
| **Total**                                      | **33** |    **33** |

As assinaturas do Stripe estavam em Backend, planejadas. Uma tabela de usuários para o painel de
administração chegou em dezembro de 2022, depois da última atualização do roadmap, então essa fica
na conta do v1.

Três das 33 marcações eram backups automáticos, restaurar um backup e réplicas de leitura. Cada uma
apontava para a documentação do Google Cloud SQL, e o documento de infraestrutura dizia que a
replicação estava "not yet used". Eu estava marcando o dever de casa do Google.

## Para onde foi o trabalho?

Para a oficina. As mensagens de commit trazem o tipo, e elas contam a história melhor do que eu:

- **52 dos 134 commits são do tipo `env` ou `environment`**: configuração, ferramentas, CI,
  atualizações e renomeações. 31 são `feat`.
- **O primeiro commit que deixa uma pessoa fazer alguma coisa** (uma API básica de usuários:
  cadastro, ler e atualizar o próprio perfil) é o número 38, de 31 de maio de 2021, quase dois anos
  depois do primeiro. Entre os 37 primeiros há 28 commits `environment`.
- **A CI foi montada três vezes**: GitLab CI em julho de 2019, GitHub Actions em março de 2021 e
  Google Cloud Build em junho de 2021. O último roadmap ainda listava CI/CD como planejado.
- **Quatro renomeações de apps e pastas em dois dias** em fevereiro de 2021, e um commit chamado
  "massive refactoring" um ano depois.

## Quanta estrutura para tão poucos dados?

O schema do banco do v1 tem três modelos: `User`, `UserDevice` e `Notification`. Em volta deles:

- **31 projetos Nx**: três apps, dois apps de teste end-to-end e 26 bibliotecas. Só o login
  compartilhado do frontend eram quatro bibliotecas: container, guards, state e UI.
- **65 arquivos `index.ts`**, e 63 deles apenas reexportam outros arquivos.
- **Uma camada CQRS com classes base próprias** sobre os barramentos de comandos, consultas e
  eventos, com 11 comandos, 5 consultas e 7 eventos, e 19 handlers.
- **Nove serviços de nuvem** no documento de infraestrutura (Cloud Run, Cloud SQL, Cloud Tasks,
  Cloud Logging, Cloud IAM, Firebase Authentication, Hosting e Storage, e Sentry), e um guia de
  configuração marcado "WIP" que começava com passos manuais.
- **104 pacotes npm** no `package.json` da raiz, 50 deles dependências de execução.

Para comparar: o Seed de hoje tem 34 pacotes de workspace em volta de 73 tabelas. A estrutura agora
cresce junto com os dados, em vez de esperar por eles.

## O problema era ter funcionalidades demais?

Não, e essa é a parte que eu quero deixar bem clara. Overengineering é construir uma
funcionalidade de um jeito mais complicado do que ela precisa: camadas a mais, proteção contra
corridas raríssimas, automação que ninguém roda. Não é "essa funcionalidade não precisa existir". A
lista de desejos do v1 estava certa. O Seed de hoje tem todas as funcionalidades de produto que o
v1 só planejou, e mais: passkeys e segundo fator, grupos com papéis e convites, cobrança por membro
no Stripe, tempo real, um app que funciona offline, armazenamento de arquivos, um painel de
administração no próprio host e nove idiomas ([README](https://github.com/spy4x/seed#readme)).

Ele continua usando CQRS, inclusive: comandos, consultas e eventos passam cada um pelo seu
barramento, e cada mudança de grupo grava seu evento num outbox que um worker esvazia. O padrão
nunca foi o culpado. Culpado foi escrever quatro bibliotecas de login antes de existir um único
grupo.

## O que o Seed faz diferente agora?

- **Um formato só para cada funcionalidade.** Uma funcionalidade nova copia a de notas arquivo por
  arquivo, numa ordem fixa: [todos os arquivos do agregado de notas](/pt-BR/docs/aggregates). O
  guia diz sem rodeio: "Do not invent a second shape", não invente um segundo formato.
- **Um servidor em vez de nove serviços.** O Docker Compose roda o app, o Postgres, o proxy e o
  monitoramento num servidor que você controla:
  [do git clone à produção num servidor da Hetzner](/blog/deploy-saas-to-one-hetzner-server) (em
  inglês).
- **Princípios que dizem não.** Os
  [princípios do Seed](https://github.com/spy4x/seed/blob/main/docs/principles.md) incluem "Ship
  small, safe slices", "Avoid speculative complexity" e "Add deps only with clear ROI": entregar em
  pedaços pequenos e seguros, não criar complexidade por precaução e só adicionar uma dependência
  quando ela claramente se paga.
- **Padrões da web antes de frameworks.** Os servidores falam Fetch, Web Crypto e WebSocket, e não
  a API privada de uma plataforma:
  [por que o Seed é construído sobre padrões da web](/blog/why-seed-free-saas-starter-web-standards)
  (em inglês).

Os tipos de commit também mudaram. Dos 531 commits do Seed desde o recomeço, 194 são `feat` e 46
são `chore`, `ci` ou `build`. Quase todos são pull requests mesclados com squash, então não têm o
mesmo tamanho dos commits do v1, mas a direção é clara.

## O seu boilerplate está fazendo o mesmo?

Três checagens rápidas, tiradas dos números do v1:

1. Conte suas pastas e suas tabelas. Mais bibliotecas do que tabelas é sinal de alerta.
2. Leia a metade "planejada" do seu roadmap. Se tudo o que um usuário tocaria está lá, você está
   construindo a oficina.
3. Ache o commit em que uma pessoa conseguiu fazer algo pela primeira vez. Se for o 38, oi, sou
   eu.

Ou pule o andaime: o [Seed](https://github.com/spy4x/seed) é gratuito, com licença MIT, e a base já
está pronta. Clone e
[entregue sua primeira funcionalidade](/blog/your-first-feature-copy-the-notes-aggregate) ainda esta
semana (em inglês).
