---
slug: seed-roda-em-deno-node-e-bun
language: pt-BR
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed agora roda em Deno, Node e Bun"
seoTitle: "Boilerplate SaaS para Node.js, Bun e Deno: o Seed roda nos três"
description: "O boilerplate SaaS gratuito Seed agora roda sem mudanças em Deno, Node.js e Bun: como começar no seu runtime, trocar um produto e o que ainda pede Deno."
tldr:
  - A API, o worker, a migração e o site do Seed agora sobem sem mudanças em Deno, Node e Bun, e a CI testa os três em cada pull request.
  - Uma linha no arquivo env, APP_RUNTIME=node ou bun, troca o runtime dos servidores. Sem a linha fica o Deno, então um produto que não mexe em nada continua funcionando.
  - O site público trocou o Fresh por uma camada pequena com as mesmas rotas, páginas e ilhas. Toda página carrega menos JavaScript.
  - Tarefas e testes continuam no Deno; o npm ou o Bun instalam ele para você.
topic: Novidades
intro: "O Seed não depende mais de um runtime só. Os servidores sobem sem mudanças em Deno, Node e Bun, e uma linha no arquivo env escolhe qual. Veja o que isso muda num produto novo e o que fazer num que já está rodando."
coverAlt: "Um broto violeta num vaso no alto de uma colina, com três caminhos subindo até ele: de pedras, de tábuas de madeira e de cascalho."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-10T09:00:00Z
newsletter: true
---

O Seed, boilerplate SaaS gratuito, agora roda em Deno, Node.js e Bun. A API, o worker em segundo
plano, a migração do banco e o site público sobem em qualquer um dos três sem mudar o código, e a CI
sobe a API, o worker e o site nos três em todo pull request. Uma linha no arquivo env escolhe o
runtime dos servidores do seu produto; sem ela, tudo continua no Deno.

Este post é para duas pessoas: quem está escolhendo um starter e não quer amarrar o produto a um
runtime só, e quem já tem um produto no Seed e vai receber essa mudança no próximo sync. Cada seção
responde a uma coisa que você pode querer fazer. Como foi a migração, com os erros, eu conto
[no meu blog](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun) (em inglês).

## Como começo um produto novo no meu runtime?

O início rápido do README agora tem uma seção por runtime:
[Node](https://github.com/spy4x/seed#node), [Bun](https://github.com/spy4x/seed#bun) e
[Deno](https://github.com/spy4x/seed#deno). Você precisa de Docker e de um dos três. No Node:

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

Sim, a primeira linha instala o Deno. Sair do Deno instalando o Deno é mais engraçado do que eu
gostaria, mas as tarefas do próprio Seed ainda rodam nele (explico abaixo), e o pacote `deno` no npm
faz uma máquina só com Node não precisar de mais nada. No Bun, a primeira linha é `bun add -g deno`
e as duas últimas são `bun run init` e `bun run dev`. A linha do `gh` é opcional: o botão "Use this
template" do GitHub e um clone fazem o mesmo.

Com isso você tem a stack inteira em Docker, no Deno. Para os servidores do produto rodarem também
em Node ou Bun, coloque uma linha em `infra/envs/.env` antes do `dev`:

```sh
APP_RUNTIME=node   # ou bun; deno, vazio ou sem a linha mantém o Deno
```

## O que roda em Node ou Bun, e o que muda lá?

Com `APP_RUNTIME=node` ou `bun`, a API, o worker, a migração e o site rodam em Node 26 ou Bun 1.4,
cada um a partir da sua própria imagem Docker. Portas, variáveis de ambiente e a ordem dos serviços
continuam iguais. A SPA e o painel de administração são arquivos estáticos, então para eles tanto
faz. A lista completa está na [seção de runtime da documentação](/pt-BR/docs/apps#runtime).

Três coisas funcionam diferente do Deno, e vale saber antes de trocar:

- **Sem modo watch.** O código é empacotado dentro da imagem, então em Node ou Bun uma mudança só
  aparece depois de reconstruir, inclusive em desenvolvimento. Desenvolver com hot reload continua no
  Deno.
- **Sem permissões de runtime para o worker.** No Deno o worker só pode ler e escrever a pasta de
  imagens dele e só pode rodar o `vips`. Node e Bun não têm esses limites: lá o worker fica contido
  só pelo contêiner e pelo usuário sem root.
- **A escolha é sua.** Sem a linha, com a linha vazia ou com `deno`, tudo continua no Deno.

## Já tenho um produto no Seed. O que eu faço?

Receba a mudança do jeito de sempre, como diz [o guia de produtos](/pt-BR/docs/products): busque o
Seed, aplique o patch e grave o commit:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Depois rode `deno task check` antes de abrir o pull request. Testei esse sync numa cópia do Seed de
logo antes da mudança de runtime, e o patch entrou sem nenhum conflito. No seu produto pode haver
conflitos onde você mudou arquivos do Seed de propósito: fique com a sua versão, como o guia diz.

O sync traz as imagens Docker de Node e Bun, os arquivos do Compose que trocam para elas e um
`package.json` na raiz. Ele não muda o runtime que você usa. Quando quiser trocar, coloque
`APP_RUNTIME=node` (ou `bun`) em `infra/envs/.env` e reconstrua as imagens:

```sh
deno task compose up -d --build
```

No servidor, coloque a mesma linha no arquivo env dele e faça o deploy de sempre
([atualizações](/pt-BR/docs/deploy-updates)): todo deploy constrói as imagens que essa linha indica.

## O que mudou no site público?

O site não roda mais no Fresh. Agora ele usa o
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server), uma camada pequena e open source que
copia as rotas, páginas e ilhas do Fresh 2, então o código do site quase não mudou. Comparei todas as
rotas nos dois builds: 419 de 423 respostas saíram idênticas. As quatro diferentes são a data de
modificação e o ETag de um vídeo, e um endereço malformado que antes recebia um erro seco e agora
recebe a página 404 do site.

As páginas também ficaram mais leves. JavaScript por página com gzip, medido com Lighthouse no
celular:

| Página                | Camada nova | Fresh   |
| --------------------- | ----------- | ------- |
| Início                | 24.0 KB     | 32.1 KB |
| Post do blog com ilha | 29.9 KB     | 38.0 KB |
| Documentação          | 8.6 KB      | 19.4 KB |

No post com um controle deslizante interativo, a página bloqueia a entrada por 5 ms, contra 48 ms no
Fresh. Minha primeira versão da camada era mais lenta que o Fresh justamente ali, e a CI não
percebeu; como eu descobri está na
[história completa](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

Se você mexeu no site do seu produto, pode sobrar depois do sync algum arquivo que ainda importa o
Fresh. Encontre-os a partir da raiz do repositório:

```sh
grep -rlE 'from "fresh' apps/mpa
```

Troque cada import por `@spy4x/preact-server` (o `fresh/runtime` também) e renomeie `FreshContext`
para `Context`. A pasta de build agora é `dist`, não `_fresh`. As páginas não têm mais script inline,
então os cabeçalhos de segurança não precisam de um nonce por requisição. A camada é uma primeira
versão: o que ela oferece e o que deixa de fora está na
[documentação dela](https://github.com/spy4x/seed/blob/main/docs/website-server.md).

## O que ainda precisa do Deno?

As ferramentas: formatação, linter, checagem de tipos, testes e os scripts por trás do `deno task`.
O `package.json` da raiz repassa as tarefas comuns ao Deno, então `npm run test` e `bun run dev`
também funcionam. Os testes continuam no test runner do Deno. Uma revisão marcada para 10 de janeiro
de 2027 decide se isso muda
([a política de runtimes](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)). Nada
disso prende ao Deno o runtime que os seus usuários acessam.

## Por que o Seed deixou de depender do Deno?

Em 9 de outubro de 2026 o time do Deno [anunciou](https://deno.com/blog/cloudflare) mais um ano de
correções de bugs e de segurança, depois do qual encerra o desenvolvimento próprio. O Deno continua
open source, e eu continuo gostando dele. Mas um starter em que você constrói um negócio não deveria
apostar o seu produto no roadmap de um runtime só, nem no meu. O Seed já era feito com padrões web
(Fetch, Web Crypto, WebSocket, módulos ES), então o difícil foi servir arquivos, os tipos do Deno em
assinaturas públicas e a camada do site, não reescrever tudo.

Experimente o [início rápido](https://github.com/spy4x/seed#quick-start) no runtime que você já usa.
Se algum passo falhar, [abra uma issue](https://github.com/spy4x/seed/issues) com o que você rodou, e
eu corrijo.
