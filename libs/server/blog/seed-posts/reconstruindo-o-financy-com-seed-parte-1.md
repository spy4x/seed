---
slug: reconstruindo-o-financy-com-seed-parte-1
language: pt-BR
translationOf: rebuilding-financy-on-seed-part-1
title: "Reconstruindo o Financy com Seed, parte 1: um produto de verdade"
seoTitle: "Reconstruindo o Financy com Seed: um produto de verdade"
description: "Estou reconstruindo o Financy, meu controle financeiro de código aberto, com Seed. Parte 1: por que recomecei, como a cópia nasceu e como foi a primeira sincronização."
tldr:
  - "O Financy, meu controle financeiro de código aberto, recomeça como uma cópia do Seed. A versão antiga fica congelada numa branch, como referência do que fazia."
  - "O primeiro commit tem os arquivos do Seed mais 19 próprios: licença, README, regras para agentes, documentos do produto e os dois arquivos .seed."
  - "A primeira sincronização, um dia depois da cópia e depois de uma troca de marca, trouxe 19 commits do Seed e 616 arquivos sem nenhum conflito."
  - "Ainda não há funções de finanças. O que qualquer produto precisaria é feito primeiro no Seed, e o Financy recebe numa sincronização."
topic: Construindo em público
intro: "Estou reconstruindo o Financy, meu controle financeiro de código aberto para uma pessoa ou uma família, com Seed, e contando enquanto acontece. Parte 1: por que joguei fora o código antigo, como um produto nasce do Seed e como foi a primeira sincronização."
coverAlt: "Uma planta violeta jovem passa de um vaso cinza rachado para um vaso violeta novo, regada por uma planta violeta grande ao lado."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

Dá para construir um produto de verdade sobre um SaaS starter e continuar recebendo as atualizações
dele? É exatamente o que estou fazendo com o [Financy](https://github.com/spy4x/financy), meu
controle financeiro gratuito e de código aberto (AGPL-3.0) para uma pessoa ou uma família. O Financy
recomeçou como cópia do Seed em 3 de novembro de 2026 e, em 4 de novembro, recebeu o primeiro lote de
mudanças do Seed: 19 commits, 616 arquivos, nenhum conflito. Esta série acompanha a reconstrução
enquanto ela acontece.

É para quem desenvolve e está escolhendo um SaaS starter e quer vê-lo usado em algo além de uma
demo, e para quem tem curiosidade sobre o Financy. Tudo aqui é público: cada número vem dos dois
repositórios no GitHub, e você pode contar cada um com git.

## Por que reconstruir o Financy em vez de consertar?

O primeiro Financy começou em abril de 2025 e chegou a 157 commits. Ele controlava contas em várias
moedas, convertia entre elas e tinha testes de ponta a ponta. Também tinha código em que não confio
mais: boa parte foi escrita às pressas com os modelos de IA da época, e a estrutura, o controle de
estado e a sincronização teriam de mudar de qualquer jeito para virar o produto que eu quero.

A outra metade da resposta é o que faltava ao Financy. Um controle financeiro para a casa precisa de
login com autenticação em dois fatores, grupos com papéis, atualizações ao vivo em todo aparelho, um
app que funcione offline, um painel de administração e um site público. Isso é o encanamento de
qualquer SaaS, não finanças, e eu tinha acabado de passar outubro construindo quase tudo isso no Seed
([o que chegou em outubro](/blog/whats-new-in-seed-october-2026), em inglês). Escrever de novo dentro
do Financy seria exatamente o erro que o Seed existe para evitar.

Então o Financy antigo fica congelado na branch
[`legacy`](https://github.com/spy4x/financy/tree/legacy). Ele é referência para **o que** o Financy
faz (funções, regras de dinheiro, casos extremos) e nunca para **como**: nem uma função auxiliar é
portada. Uma regra de dinheiro tirada de lá é uma hipótese: primeiro vira teste, depois código novo.

## Como o Financy começou a partir do Seed?

Com um único pull request, o [financy#83](https://github.com/spy4x/financy/pull/83): os arquivos do
Seed mais os 19 que transformam a cópia no Financy. Contei comparando o primeiro commit do Financy
com o commit do Seed que ele registra:

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

Esses 19 arquivos são: a licença AGPL-3.0, com o aviso MIT do Seed num arquivo próprio; um README que
diz com todas as letras que o app ainda não está pronto; o `AGENTS.md` do Financy, as regras que todo
agente e toda pessoa que trabalha nele segue; os documentos do produto; o nome da imagem no pipeline
de release, para que uma tag do Financy nunca sobrescreva as imagens do Seed; os quatro arquivos
criptografados de configuração do servidor do Seed, removidos; e os dois arquivos que tornam a
sincronização possível.

Esses dois são o truque inteiro. `.seed/commit` guarda o commit do Seed a que a cópia corresponde, e
`.seed/skip` lista os caminhos do Seed cujas mudanças o Financy nunca aceita, como o README.
Sincronizar é então um `git diff` desse commit até o `main` atual do Seed, aplicado com um merge de
três vias. A receita completa está em
[Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates)
(em inglês); este post conta o que aconteceu quando eu a segui de verdade.

## A primeira sincronização funcionou mesmo?

Sim, e com uma pequena armadilha colocada de propósito. Antes de sincronizar, o Financy já tinha
mudado arquivos do Seed: o [financy#123](https://github.com/spy4x/financy/pull/123) deu a ele o
nome, um ícone de carteira e um azul próprio no lugar do violeta do Seed, em 32 arquivos. Uma
sincronização que só funciona numa cópia intocada não provaria nada.

Depois, o [financy#127](https://github.com/spy4x/financy/pull/127) levou o Seed de `ec61062b` para
`d9641f03`. São 19 pull requests do Seed e 616 arquivos alterados, e o `git apply --3way` aplicou
tudo sem conflito. Entre o que chegou:

- login com um código enviado por e-mail;
- um preço anual ao lado do mensal;
- um fuso horário para o grupo inteiro;
- a API e o worker rodando em Node e Bun, além de Deno;
- uma configuração de onde começa o changelog de um produto.

A sincronização também mostrou um passo que o produto faz à mão. O Seed tinha acabado de ganhar o
`AGENTS.seed.md`, as regras do próprio repositório do Seed; o Financy apagou o arquivo e o colocou
em `.seed/skip`, para que nenhuma sincronização futura o traga de volta. Depois da sincronização, o
Financy difere do Seed em 59 arquivos, e todos foram mudados pelo Financy de propósito.

## O que vai para o Seed em vez do Financy?

Tudo de que qualquer SaaS precisaria. O `AGENTS.md` do Financy define a ordem: código que qualquer
projeto poderia usar vai para as bibliotecas compartilhadas `@spy4x/*`, código de que qualquer
produto feito com Seed precisaria vai para o Seed, e só o que um produto de finanças precisa
(contas, transações, orçamentos, câmbio) fica no Financy. Nada de gambiarra local "para mover
depois": "depois" é como um fork se afasta.

Três itens da lista acima são exatamente isso. O Financy precisa de cobrança anual, o mês de uma
casa precisa de um só fuso horário para todos os membros, e o changelog não pode começar com anos de
commits do app antigo. Nada disso é sobre dinheiro, então cada item foi construído no Seed e chegou
ao Financy pela sincronização. Em 3 e 4 de novembro, 31 issues novas no Seed citaram o Financy, e
até 5 de novembro 8 delas já estavam fechadas.

A reconstrução também achou buracos na minha própria receita. A lista do que um produto remove do
site do Seed esquecia vários arquivos, e o passo 1 registrava o commit mais novo do Seed, que pode
ser mais novo que a cópia, e então a primeira sincronização pularia em silêncio os commits do meio.
Os dois foram corrigidos no Seed ([seed#811](https://github.com/spy4x/seed/pull/811)), e o
[guia](/pt-BR/docs/products) agora explica como achar o commit cujos arquivos batem com os seus. Essa
correção vale mais para você do que para mim: o próximo produto feito com Seed não vai cair nela.

## O que ainda falta?

Quase tudo. Enquanto escrevo, o Financy é o Seed com o nome, a licença e a cor do Financy. Ainda não
existe tela de contas, transações ou orçamentos, então não tente usar ainda. Nem o nome está
decidido: a [financy#126](https://github.com/spy4x/financy/issues/126) pergunta se ele fica até o
lançamento.

O plano é público: [as issues do Financy](https://github.com/spy4x/financy/issues), divididas em sete
marcos, da fundação ao lançamento e ao que vem depois. Cada lacuna que elas encontrarem no Seed é
corrigida no Seed, então esta série vai mostrar os dois lados: o que o Financy precisou e o que o
Seed aprendeu com isso.

## Acompanhe

[Acompanhe o repositório do Financy](https://github.com/spy4x/financy) (botão Watch) para ver cada
pull request chegar, e assine este blog para receber a parte 2 por e-mail. Se você está prestes a
começar um produto seu, [o guia](/pt-BR/docs/products) é o mesmo que o Financy segue e, se algum
passo falhar para você, [abra uma issue](https://github.com/spy4x/seed/issues): é sinal de que falta
uma linha na receita.
