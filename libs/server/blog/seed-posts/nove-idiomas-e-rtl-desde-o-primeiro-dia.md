---
slug: nove-idiomas-e-rtl-desde-o-primeiro-dia
language: pt-BR
translationOf: nine-languages-and-right-to-left-from-day-one
title: "Internacionalização de SaaS desde o primeiro dia: nove idiomas e árabe da direita para a esquerda"
seoTitle: "Internacionalização de SaaS: nove idiomas e RTL desde o início"
description: "Como um produto feito com o Seed já nasce em nove idiomas, com árabe da direita para a esquerda, e quais testes impedem que um texto sem tradução ou uma margem que não inverte chegue à produção."
tldr:
  - O app, o painel de administração, o site e os e-mails do Seed estão em nove idiomas, árabe incluído, com cerca de 3.900 mensagens em cada um.
  - Um teste quebra o build se falta uma mensagem, se ela ficou desatualizada ou perdeu um marcador. Outro recusa uma margem “esquerda” ou “direita” que não inverteria em árabe.
  - O idioma é uma configuração da pessoa, salva no servidor, separada do formato de data, do fuso horário e do relógio.
  - Um décimo idioma é uma entrada numa lista, um arquivo por catálogo e algumas linhas de carregamento.
topic: Em detalhe
author: Anton Shubin
publishAt: 2026-11-02T20:00:00Z
newsletter: false
---

Como fazer um SaaS em vários idiomas, com árabe da direita para a esquerda, sem precisar reescrever
tudo depois? Começando pela primeira tela e deixando os testes tomarem conta. O Seed sai em nove
idiomas: português do Brasil, inglês, russo, espanhol, alemão, árabe, francês, japonês e chinês
simplificado. Isso vale para o app, o painel de administração, o site e os e-mails. Em árabe, o
layout inteiro vira do avesso.

Este texto é para fundadores e desenvolvedores que sabem que “a gente traduz depois” quer dizer “a
gente nunca traduz”. Vou mostrar onde ficam os textos, o que os testes pegam e quanto o RTL custa
de verdade.

## Por que desde o primeiro dia?

Porque traduzir depois obriga você a passar duas vezes por cada tela. É preciso achar cada texto
escrito direto no código, cada data montada à mão, cada `margin-left`, num código que a essa altura
já está cheio de funcionalidades. Traduzindo desde o início, cada tela nova é traduzida enquanto é
construída: alguns minutos, e não um projeto que ninguém quer começar.

E há um motivo mais simples: a maioria das pessoas na internet não lê primeiro em inglês. Um
produto que fala a língua delas sai na frente.

## Onde ficam os textos?

Cada palavra que as telas do Seed mostram está num catálogo: um arquivo TypeScript por área e
idioma, como `i18n/app/pt-BR.ts` ou `i18n/site/ja.ts`. São cinco áreas: o app, o painel, o site,
os e-mails e as mensagens de erro da API. O inglês é a fonte, e os outros arquivos têm as mesmas
chaves.

| Área            | Mensagens por idioma |
| --------------- | -------------------: |
| O app           |                1.503 |
| Painel de admin |                1.487 |
| Site            |                  682 |
| Códigos de erro |                  164 |
| E-mails         |                   79 |

São cerca de 3.900 mensagens por idioma, contadas em 2 de novembro de 2026. Os componentes do
preact-components trazem também seus próprios catálogos.

O app carrega só o seu idioma, num arquivo pequeno separado: quem lê em português não baixa o
japonês.

## O que impede uma tradução de ficar desatualizada?

Um teste, `i18n/i18n.test.ts`. Ele falha quando:

- falta uma mensagem em algum idioma, ou sobra uma que o inglês não tem mais;
- o inglês mudou depois da tradução (cada idioma guarda um arquivo lock que registra de qual
  versão do inglês a tradução foi feita);
- uma tradução perdeu ou escreveu errado um marcador como `{count}`, ou uma tag em volta de um
  link;
- falta a um plural uma forma de que o idioma precisa. O árabe tem seis;
- nenhum código usa mais uma mensagem em inglês.

Assim não vai para o ar um botão escrito `Notes.create`, nem uma tela em alemão uma semana atrás da
versão em inglês.

## Quanto custa de verdade a escrita da direita para a esquerda?

Menos do que parece, desde que o layout nunca diga “esquerda” ou “direita”. Os estilos do Seed
usam lados lógicos: “início” e “fim”. Numa página da esquerda para a direita, o início fica à
esquerda; em árabe, à direita. Quem inverte é o navegador.

Um teste transforma isso em regra: `tests/spacing.test.ts` percorre todos os apps e falha em
qualquer classe de espaçamento que cite um lado físico. A página define `dir` pelo idioma: o site
no servidor, e o app no momento em que você troca de idioma.

Mais dois detalhes que doem tarde se você pular:

- **Nomes dentro de frases.** “Ana convidou você para o grupo Team” mistura direções em árabe, e
  um nome em alfabeto latino pode arrastar a pontuação para o lado errado. Os valores dos usuários
  ficam dentro de `<bdi>`, que isola a direção deles do resto do texto.
- **Datas, números e horas.** Toda data de toda tela passa por um único formatador. Outro teste,
  `tests/no-direct-date-format.test.ts`, falha em qualquer chamada direta a `toLocaleString()`.

## Idioma, formato regional e relógio são três configurações

O idioma é salvo no servidor junto com o perfil, então vale em todos os seus aparelhos e em todos
os e-mails. O formato regional, o fuso horário e o relógio de 12 ou 24 horas são configurações à
parte. Uma brasileira morando em Lisboa quer o app em português do Brasil e o horário de Lisboa.
Um americano morando em São Paulo quer textos em inglês e datas como `03/11/2026`. Amarrar tudo
numa coisa só é o jeito certo de mostrar a data errada para metade dos seus usuários.

No site, o idioma fica no endereço (`/pt-BR/pricing`, `/ar/pricing`), sem redirecionamento por
navegador ou IP, e cada página diz aos buscadores quais versões existem.

## Quem traduz?

Agentes de IA, seguindo um guia escrito, `i18n/TRANSLATING.md`. Ele define o tom de cada idioma
(em português, tratando por “você”), um glossário para que cada coisa tenha um nome só em todas as
telas, e a regra de traduzir a situação, não as palavras. Um segundo agente traduz cada tradução
nova de volta para o inglês e compara o sentido. Não é uma agência de tradução profissional, e não
vou fingir que é. Mas é muito melhor do que uma tela que ninguém consegue ler.

## Como adicionar um décimo idioma

Uma entrada na lista de idiomas, um arquivo de catálogo por área e algumas linhas em cada app que
o carregam. Depois, os testes listam cada mensagem que falta ao idioma novo e continuam vermelhos
até ele ficar completo.

## Experimente

Abra a [demo](https://app.seedsaas.com), vá ao seu perfil e mude o idioma para árabe. Veja o app
inteiro virar do avesso e depois volte para o português. Este artigo também existe nos nove
idiomas, e o [código](https://github.com/spy4x/seed) é MIT.
