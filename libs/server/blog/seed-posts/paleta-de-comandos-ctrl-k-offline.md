---
slug: paleta-de-comandos-ctrl-k-offline
language: pt-BR
translationOf: ctrl-k-command-palette-offline
title: "Como criar uma paleta de comandos Ctrl+K (command palette) que funciona offline"
seoTitle: "Paleta de comandos Ctrl+K: como criar uma que funciona offline"
description: "Uma paleta de comandos Ctrl+K deve rodar o app inteiro, perdoar erros de digitação e o layout de teclado errado, e continuar funcionando offline. Veja como o Seed monta a dele a partir de uma única lista de comandos."
tldr:
  - "Uma paleta de comandos deve rodar o app, não só buscar nele. Páginas, ações de criar e configurações são comandos, e uma configuração muda no instante em que você aperta Enter."
  - "Case o início das palavras, aceite um erro de digitação por palavra e leia a busca no outro layout de teclado. Assim \"notse\" acha Notes e \"ntvf\" acha Theme."
  - "Nunca termine em \"No results\". Ofereça criar o que foi digitado, busque na cópia do dispositivo quando o servidor estiver fora de alcance e esmaeça o que precisa de conexão."
  - "Mantenha tudo em uma lista pura: o estado do app entra, comandos saem. As teclas vêm da única lista de atalhos do app, então a paleta e o diálogo de atalhos nunca discordam."
topic: Em detalhe
intro: "A paleta Ctrl+K do Seed roda o app inteiro, acha as coisas apesar de erros de digitação e do layout de teclado errado, e continua funcionando sem rede. Veja o que ela faz e o único arquivo de onde ela sai."
relatedFeature: shortcuts
coverAlt: "Uma tecla roxa em branco brilha sobre uma mesa ao lado de um cabo desconectado, e dela sobem quatro cartões de papel com uma lua, um sol, uma página e uma casa."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

Para criar uma paleta de comandos Ctrl+K (a famosa command palette) que funcione offline e que as
pessoas continuem usando, faça ela cumprir três coisas. Ela roda o app: cada página, cada "New…"
e cada configuração é um comando. Ela perdoa o jeito como as pessoas digitam de verdade: um erro
de digitação, meia palavra, o layout de teclado errado. E ela nunca te deixa num beco sem saída:
quando nada bate, ela oferece criar o que você digitou, e sem rede ela busca na cópia que está no
seu dispositivo. No Seed, tudo isso sai de uma lista de comandos em um único arquivo.

Este texto é para quem está colocando Ctrl+K no próprio app web. Primeiro mostro o que a paleta
faz, depois o arquivo de onde ela sai, com o código real.

![A paleta de comandos do Seed com "ntvf" digitado no campo de busca. A primeira linha, destacada sob o título Commands, é Theme, com a seção dela, Settings, numa segunda linha e o valor atual "System" ao lado.](/shots/palette-dark-800.webp)

## O que o Ctrl+K deve fazer além de buscar?

Abra a paleta e não digite nada. Ela já serve para alguma coisa: suas cinco últimas escolhas em
Recent (recentes), os comandos da página em que você está, suas notas mais novas e Create (criar).
A maioria das minhas próprias idas à paleta é "me leva de volta àquela coisa" ou "faz o óbvio
aqui", e nenhuma das duas deveria exigir digitação.

Digite só `>` e ela lista tudo o que o app sabe fazer, em cinco seções: This page (esta página),
Go to (ir para), Create, Settings (configurações) e Account (conta). Digite qualquer outra coisa e
os comandos que batem dividem uma única seção, Commands (comandos), cada linha com o nome da sua
seção, e Create logo abaixo deles. Os exemplos usam o app em inglês, por isso os nomes aparecem
como na tela. Algumas escolhas que valeram a pena:

- **Configurações agem na hora.** Digite `light` e aperte Enter: a página fica clara e a paleta
  continua aberta. Digite `dark`, Enter, e você está de volta. Nada de ir até uma página de
  configurações para ver se gostou.
- **As teclas ficam ao lado dos comandos.** New note mostra sua tecla, N, na própria linha. Um
  atalho de duas teclas, como G depois N para a página Notes, aparece no diálogo Keyboard shortcuts
  (atalhos de teclado), que lê a mesma lista de comandos. A cola já vem embutida.
- **`>` significa só comandos.** Comece a busca com `>` e continue digitando: notas e grupos saem
  da frente.
- **Enter espera a resposta.** A paleta dá uma resposta por busca, notas incluídas. Aperte Enter
  antes de o servidor responder e ela espera, então você nunca abre a linha que por acaso estava em
  primeiro meio segundo antes.

Uma caixa de busca que só acha notas é meia paleta. A outra metade é o motivo de as pessoas
manterem as mãos no teclado.

## Como ela acha as coisas apesar de erros de digitação e do layout de teclado errado?

Digite `notse` e a primeira linha é a página Notes. Digite `ntvf` e você recebe Theme, como na
imagem acima. Esse segundo parece coisa de gato andando no teclado. É "тема", a palavra russa para
tema, digitada com o layout em inglês ainda ligado. Meu teclado tem dois layouts, e eu estou no
errado com frequência suficiente para `ntvf` virar caso de teste.

O matcher segue algumas regras simples:

1. Maiúsculas, minúsculas e acentos são ignorados.
2. As palavras podem vir em qualquer ordem, e cada palavra digitada só precisa ser o começo de uma
   palavra do nome do comando ou de um dos seus outros nomes. `no all` basta para "all notes".
3. Uma palavra de quatro letras ou mais pode ter um erro de digitação: uma letra a mais, faltando
   ou errada, ou duas letras trocadas de lugar.
4. A busca também é lida como se o outro layout de teclado estivesse ligado, e entre alfabetos,
   então letras latinas acham uma palavra em russo e vice-versa. Hoje isso vale para os layouts
   inglês e russo. Qualquer outro par precisa do próprio mapa de teclas.

Quando várias linhas batem, vence a correspondência mais limpa: primeiro um nome exato, depois um
nome que começa com a busca, depois palavras que batem, depois um alias, depois o outro layout, e o
erro de digitação por último. Assim, perdoar um erro nunca empurra uma resposta certa para baixo.

Cada comando também carrega as palavras que as pessoas tentam, em inglês e em russo. Notes
responde a "all notes" e "заметки"; Activity (atividade), a "history", "log" e "audit". Ninguém
lembra como você chamou a página. As pessoas lembram como elas teriam chamado.

A alternativa de costume é um fuzzy matcher, aquele que aceita quaisquer letras desde que apareçam
em ordem. Ele é a melhor escolha para um seletor de arquivos, em que `gtn` deve achar
`go-to-notes.ts`. Para uma lista de comandos, ele é generoso demais: poucas letras podem bater com
linhas que não têm nada a ver com o que você queria, e ele continua sem saber que `ntvf` é uma
palavra. Início de palavra mais um erro de digitação é mais rígido, e isso combina com nomes curtos
feitos para gente.

Um erro por palavra é o limite. Dois erros na mesma palavra não acham nada: é um matcher, não um
leitor de mentes. O matcher fica numa biblioteca compartilhada sob licença MIT,
[`@spy4x/platform`](https://jsr.io/@spy4x/platform), que você pode importar sem o resto do Seed.
Ele prepara os nomes de cada comando uma vez só, então cada tecla paga só pela ordenação.

## O que ela mostra quando nada bate?

"No results" (nenhum resultado) é a paleta mandando você embora. A do Seed nunca diz isso, porque
qualquer coisa que você digitou é um título perfeitamente bom para a próxima coisa.

Digite `Palette demo`. Nada se chama assim, então a seção Create oferece `New note: “Palette
demo”`. Enter abre o formulário de nova nota com o título preenchido. Ctrl+Enter pula o
formulário: a nota é criada e aberta.

Essas linhas são montadas a partir da busca, nunca comparadas com ela, então qualquer texto as
recebe:

```ts
export function quickCreateRows(context: PaletteContext, query: string): PaletteOption[] {
  const { t, currentGroup } = context
  const title = query.trim()
  if (title === "") return []
  const writable = currentGroup?.canWrite && context.notes !== false ? currentGroup : null
  const row = (entity: QuickCreateEntity, key: string): PaletteOption => ({
    id: `quick-create-${entity}`,
    label: t.t(`Search.withText`, { label: t.t(key), text: isolate(quoted(title)) }),
    group: t.t(`Search.create`),
    choice: { kind: "quick-create", entity, title },
  })
  // …uma nota e uma tag quando a pessoa pode escrever aqui, e um grupo
}
```

Um viewer, que não pode escrever, não recebe a linha "New note". A paleta só oferece o que os
botões da página ofereceriam.

## Como ela continua funcionando offline?

Duas coisas podem dar errado sem rede: a busca não tem a quem perguntar, e alguns comandos não têm
quem os execute. A paleta trata cada uma separadamente.

**A busca recorre ao dispositivo.** O app do Seed já guarda uma cópia das suas notas no banco local
do navegador (essa é
[a camada offline-first](/blog/offline-first-preact-signals-local-database-sync), em inglês). A
paleta pergunta primeiro ao servidor e, quando não consegue alcançá-lo, busca nessa cópia:

```ts
return async (query, signal) => {
  if (query === "") return { notes: await recentNotes(sources), onDevice: !sources.canCall() }
  if (sources.canCall()) {
    try {
      const answer = await sources.server(query, signal)
      return { notes: answer.notes.map(fromWire), onDevice: false }
    } catch (error) {
      if (signal.aborted || !(isUnreachable(error) || isProxyAnswer(error))) throw error
    }
  }
  return { notes: await notesOnDevice(sources, indexOf, query), onDevice: true }
}
```

Esse é o
[`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts).
Três detalhes nele importam:

- O título da seção muda para "Notes on this device" (notas neste dispositivo), para você saber
  que a resposta pode ser mais antiga que a do servidor.
- Só um servidor inalcançável dispara o fallback. Uma recusa, como o rate limit, aparece como
  erro. Escondê-la atrás de resultados locais seria mentir com educação.
- O dispositivo ainda pode guardar notas de um grupo do qual você saiu. A busca olha só os grupos
  dos quais você faz parte agora.

A busca local é um pequeno índice no dispositivo, um mecanismo diferente do matcher dos comandos,
e perdoa os mesmos deslizes. Desligue a rede na demo, digite `pallette` com dois l, e a nota
"Palette demo" que você criou acima com Ctrl+Enter aparece. Com `зфдуееу` também, que é a mesma
palavra digitada no layout russo.

**Comandos que precisam do servidor continuam na lista.** Offline, "New group" ou "Delete my
account" poderiam sumir da lista sem aviso. Aí você ficaria se perguntando se o recurso existe.
Em vez disso, eles ficam onde estavam, esmaecidos, com "Needs a connection" (precisa de conexão)
ao lado:

```ts
const SERVER_ONLY = new Set(
  [
    `import-notes`,
    `new-group`,
    `keep`,
    `download-data`,
    `change-picture`,
    `delete-account`,
    `turn-off-two-factor`,
    `end-other-sessions`,
  ].map((id) => `action-${id}`),
)

function needsServer(context: PaletteContext, option: PaletteOption): PaletteOption {
  return {
    ...option,
    disabledReason: context.online ? undefined : context.t.t(`Search.needsConnection`),
  }
}
```

New note e New tag não estão nessa lista. Eles funcionam offline: a escrita espera numa fila e
sai quando a conexão volta.

## Como ela é construída? Uma lista de comandos

O registro inteiro é o
[`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts).
É uma função pura: o estado do app entra (quem você é, qual grupo, online ou não) e uma lista de
opções sai. Sem store, sem `fetch`, sem router. Um comando é uma entrada:

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

A chave de tradução do rótulo, para onde ele leva, as palavras que o acham. `href` devolve `null`
quando a pessoa não pode ir até lá, e o comando fica de fora.

Repare no que a entrada não tem: as teclas. G depois N não está escrito em lugar nenhum desse
arquivo. O app tem uma lista de atalhos, e a paleta busca as teclas ali pela mesma chave de
tradução:

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

Assim, a paleta e o diálogo Keyboard shortcuts não têm como discordar. A outra versão, com as
teclas digitadas em dois lugares, funciona até o dia em que uma delas muda. O diálogo também lê o
mesmo registro de volta e lista cada comando com as palavras que o acham.

Cada opção carrega uma escolha, um objetinho como `{ kind: "quick-create", entity, title }`. O app
a executa pela mesma função que os botões chamam. A paleta nunca ganha uma segunda implementação
de "criar uma nota" que vai se afastando da real.

Por ser pura, ela é barata de testar: sem navegador, só estado entrando e linhas saindo. Os testes
se leem como a lista de recursos, por exemplo "put Go to Notes first for notse and заметки" e "keep
each command the server must run listed offline, dimmed with why, and dim none online". Eles ficam
em
[`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts).

O painel de admin tem a mesma paleta. Os comandos dele são uma segunda lista de 268 linhas, e todo
o resto é compartilhado.

## Como um produto adiciona os próprios registros?

O Seed é um template inicial, então a paleta precisa achar coisas de que eu nunca ouvi falar: suas
faturas, contatos, projetos. Um produto os entrega como registros:

```ts
export interface PaletteRecord {
  /** Unique within its source. */
  id: string
  /** What the palette lists and matches, in the person's language. */
  label: string
  /** The row's second line, such as an amount or a date. It is shown, not matched. */
  detail?: string
  /** Other words that find it, such as a number or an old name. */
  aliases?: readonly string[]
  /** The page a pick opens, as a page command does. */
  href: string
}
```

Uma fonte é um título de seção mais uma função que devolve os registros que o dispositivo guarda
agora
([`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)). Eles
são comparados no dispositivo pelo mesmo matcher dos comandos, então uma fatura ganha de graça o
perdão a erros de digitação e de layout, online ou não. Um porém: a função é chamada a cada tecla,
então precisa responder da memória e deve devolver os mesmos objetos enquanto nada mudou. O
matcher prepara cada objeto uma vez e reaproveita esse trabalho.

## Tente quebrar

Abra a [demo ao vivo](https://app.seedsaas.com/try) e aperte "Try it now" (experimente agora). Você
ganha uma conta de convidado com notas de exemplo. Depois:

1. Aperte Ctrl+K (⌘K no Mac) e digite `notse`, depois `ntvf`.
2. Digite `light`, aperte Enter, depois `dark`, Enter.
3. Digite um título que ninguém usou e aperte Ctrl+Enter.
4. Desligue a rede nas ferramentas de desenvolvedor do navegador e busque essa nota com um erro de
   digitação.

Tudo isso está sob licença MIT [no repositório](https://github.com/spy4x/seed), e as teclas estão
listadas na [página de atalhos](/pt-BR/features/shortcuts). Se você achar um erro de digitação que
ela deveria ter perdoado e não perdoou, é um teste que eu ainda não escrevi.
