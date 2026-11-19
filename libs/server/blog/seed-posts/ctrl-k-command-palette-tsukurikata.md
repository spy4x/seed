---
slug: ctrl-k-command-palette-tsukurikata
language: ja
translationOf: ctrl-k-command-palette-offline
title: "オフラインでも動くCtrl+Kコマンドパレットの作り方"
seoTitle: "オフラインでも動くCtrl+Kコマンドパレットの作り方"
description: "Ctrl+Kのコマンドパレットの作り方です。アプリ全体を操作でき、タイプミスや間違ったキーボード配列を許し、オフラインでも動き続けるパレットを、Seedが一つのコマンドリストからどう作っているかを紹介します。"
tldr:
  - "コマンドパレットは検索するだけでなく、アプリを操作できるべきです。ページ、作成アクション、設定はすべてコマンドで、設定はEnterを押した瞬間に変わります。"
  - "単語の先頭で照合し、1単語にタイプミスを一つ許し、クエリをもう一方のキーボード配列でも読みます。すると「notse」でNotesが、「ntvf」でThemeが見つかります。"
  - "「No results」で終わらせないこと。入力したものの作成を提案し、サーバーに届かなければデバイス上のコピーを検索し、接続が必要なものは薄く表示します。"
  - "一つの純粋なリストにして、アプリの状態を入れ、コマンドを出します。キーはアプリに一つしかないショートカットのリストから取るので、パレットとショートカットのダイアログが食い違うことはありません。"
topic: 詳しく
intro: "SeedのCtrl+Kパレットはアプリ全体を操作でき、タイプミスや間違ったキーボード配列でも目的のものを見つけ、ネットワークがなくても動き続けます。何ができるのかと、それを作っている一つのファイルを紹介します。"
relatedFeature: shortcuts
coverAlt: "机の上で、何も書かれていない紫色のキーが、抜けたケーブルの横で光っています。そこから4枚の紙のカードが浮かび上がり、月、太陽、ページ、家が描かれています。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

使い続けてもらえるCtrl+Kのコマンドパレットは、どう作ればよいでしょうか。コマンドパレットの作り方で大事なのは、三つのことをさせることです。一つ目に、アプリを操作できること。すべてのページ、すべての「New…」、すべての設定がコマンドです。二つ目に、人の実際の打ち方を許すこと。タイプミス、途中までの単語、間違ったキーボード配列です。三つ目に、行き止まりにしないこと。何も一致しなければ入力したものを作ることを提案し、ネットワークがなければデバイス上のコピーを検索します。Seedでは、これがすべて一つのファイルにある一つのコマンドリストから来ています。

この記事は、自分のWebアプリにCtrl+Kを付けようとしている開発者のためのものです。まずパレットが何をするかを見せ、それから実際のコードで、パレットを作っているファイルを紹介します。

![Seedのコマンドパレット。検索欄に「ntvf」と入力されています。ハイライトされた先頭の行はSettingsの下のThemeで、横に現在の値「System」が表示されています。](/shots/palette-dark-800.webp)

## Ctrl+Kは検索以外に何をすべき？

パレットを開いて、何も入力しないでください。それだけでもう役に立ちます。Recent（最近使ったもの）に直近に選んだ5件、今いるページのコマンド、最新のメモ、そしてCreate（作成）が並びます。パレットを開く理由の多くは「さっきのあれに戻して」か「ここで当然やることをやって」で、どちらも入力が要るべきではありません。

次に、アプリでできることがすべて、五つの見出しの下に並びます。This page（このページ）、Go to（移動）、Create、Settings（設定）、Account（アカウント）です。以下の例は、アプリを英語表示にして使っています。やってよかった選択をいくつか挙げます。

- **設定はその場で効きます。** `light` と入力してEnterを押すと、ページが明るくなり、パレットは開いたままです。`dark` と入力してEnterで元に戻ります。気に入るかどうか確かめるために、設定ページまで行く必要はありません。
- **キーはコマンドの横にあります。** New note（新しいメモ）は、自分の行にキーのNを表示します。Notesページへ行くG、次にNのような二つのキーのショートカットは、同じコマンドリストを読むKeyboard shortcuts（キーボードショートカット）ダイアログに載っています。早見表は誰にも要りません。
- **`>` はコマンドだけ。** クエリを `>` で始めると、メモやグループが邪魔をしなくなります。
- **Enterは答えを待ちます。** パレットは、メモも含めてクエリごとに一つの答えを出します。サーバーが返事をする前にEnterを押すと待つので、0.5秒前にたまたま先頭にあった行を開いてしまうことはありません。

メモしか見つけない検索ボックスは、パレットの半分にすぎません。残りの半分が、人がキーボードから手を離さない理由です。

## タイプミスや間違ったキーボード配列でも、どうやって見つける？

`notse` と入力すると、先頭の行はNotesページです。`ntvf` と入力すると、上の画像のとおりTheme（テーマ）が出ます。二つ目は猫がキーボードの上を歩いた跡のように見えますが、ロシア語で「テーマ」を意味する「тема」を、英語配列のまま打ったものです。私のキーボードには英語とロシア語の二つの配列があり、間違った方になっていることがよくあるので、`ntvf` は今ではテストケースになっています。

マッチャーは、いくつかの単純なルールに従います。

1. 大文字と小文字、アクセント記号は区別しません。
2. 単語はどの順番でもよく、入力した各単語は、コマンド名かその別名のどれかに含まれる単語の先頭に一致すれば足ります。「all notes」なら `no all` で十分です。
3. 4文字以上の単語は、タイプミスを一つ含んでいてもかまいません。1文字多い、足りない、違う、または2文字が入れ替わっている場合です。
4. クエリは、もう一方のキーボード配列がオンだった場合としても、文字体系をまたいでも読まれます。だからラテン文字でロシア語の単語が見つかり、その逆もできます。

複数の行が一致したときは、よりきれいな一致が勝ちます。完全に一致する名前が最初、次にクエリで始まる名前、次に一致する単語、次に別名、次にもう一方の配列、タイプミスは最後です。だからタイプミスを許しても、正しい答えが下に押しやられることはありません。

どのコマンドも、人が試しそうな言葉を英語とロシア語で持っています。Notesは「all notes」と「заметки」に、Activity（アクティビティ）は「history」「log」「audit」に応えます。あなたがそのページを何と名付けたかは、誰も覚えていません。覚えているのは、自分ならそれを何と呼んだかです。

よくある代案はファジーマッチャーです。文字が順番どおりに現れさえすれば何でも受け入れる種類のものです。ファイルピッカーならこちらが向いています。`gtn` で `go-to-notes.ts` が見つかるべきだからです。コマンドのリストには寛容すぎます。数文字で、意図と全く関係のない行に一致しうるうえに、`ntvf` が単語だとは相変わらずわかりません。単語の先頭とタイプミス一つのほうが厳しく、それが人間向けの短い名前に合っています。

タイプミスは1単語に一つまでです。一つの単語に二つあると、何も見つかりません。マッチャーであって、読心術師ではないのです。マッチャーは共有ライブラリ [`@spy4x/platform`](https://jsr.io/@spy4x/platform) にあり、各コマンドの名前を一度だけ前処理するので、数百行をキー入力のたびに並べ直しても誰も気づきません。

## 何も一致しないときは何を表示する？

「No results」（結果なし）は、パレットが「帰ってくれ」と言っているのと同じです。Seedのパレットはこれを決して言いません。何を入力したにせよ、それは次に作るものの立派なタイトルになるからです。

`Palette demo` と入力してみてください。その名前のものはないので、Createセクションが `New note: “Palette demo”` を提案します。Enterで、タイトルが入った新規メモのフォームが開きます。Ctrl+Enterならフォームを飛ばして、メモが作成されて開きます。

これらの行はクエリから作られ、クエリと照合されることはないので、どんなテキストにも出てきます。

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
  // …ここに書き込める人にはメモとタグ、そしてグループ
}
```

書き込みを許されていないviewerには、「New note」の行は出ません。パレットが提案するのは、そのページのボタンが提案するものだけです。

## オフラインでどうやって動き続ける？

ネットワークがないと、二つのことがうまくいかなくなります。検索には問い合わせる相手がいなくなり、一部のコマンドには実行してくれる相手がいなくなります。パレットはそれぞれを別々に扱います。

**検索はデバイスにフォールバックします。** Seedのアプリは、すでにブラウザのローカルデータベースにメモのコピーを持っています（[オフラインファーストの層](/blog/offline-first-preact-signals-local-database-sync)（英語）です）。パレットはまずサーバーに尋ね、サーバーに届かないときは、代わりにそのコピーを検索します。

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

これが [`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts) です。大事な点が三つあります。

- 見出しが「Notes on this device」（このデバイス上のメモ）に変わるので、答えがサーバーのものより古いかもしれないとわかります。
- フォールバックするのは、サーバーに届かないときだけです。レート制限のような拒否は、エラーとして表示します。それをローカルの結果の陰に隠すのは、丁寧な嘘になります。
- デバイスには、すでに抜けたグループのメモが残っているかもしれません。検索は、今所属しているグループだけを見ます。

ローカル検索も同じことを許します。デモでネットワークを切り、lを二つにした `pallette` と入力すると、「Palette demo」のメモが見つかります。同じ単語をロシア語配列で打った `зфдуееу` でも見つかります。

**サーバーが必要なコマンドもリストに残ります。** オフラインのとき、「New group」（新しいグループ）や「Delete my account」（アカウントの削除）は、リストから黙って消してしまうこともできます。そうすると、その機能がそもそもあるのか迷うことになります。そうはせず、元の場所に薄く表示したまま、横に「Needs a connection」（接続が必要）と添えます。

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

New noteとNew tag（新しいタグ）は、このリストに入っていません。オフラインでも動きます。書き込みはキューで待ち、接続が戻ったら送られます。

## どう作られている？コマンドのリストは一つ

レジストリ全体が [`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts) です。純粋関数で、アプリの状態（あなたが誰か、どのグループか、オンラインかどうか）を受け取り、選択肢のリストを返します。ストアも `fetch` もルーターもありません。コマンドは1エントリです。

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

ラベルの翻訳キー、行き先、それを見つける言葉です。その人が行けない場所なら `href` が `null` を返し、コマンドは外されます。

このエントリにないものを見てください。キーです。G、次にNは、このファイルのどこにも書かれていません。アプリにはショートカットのリストが一つあり、パレットは同じ翻訳キーで、そこからキーを引きます。

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

だから、パレットとKeyboard shortcutsダイアログが食い違うことはありえません。キーを2か所に書く別のやり方は、どちらかが変わる日までは動きます。ダイアログも同じレジストリを読み返し、すべてのコマンドを、それを見つける言葉とともに一覧にします。

各選択肢は、`{ kind: "quick-create", entity, title }` のような小さなオブジェクト、choiceを持っています。アプリはそれを、ボタンが呼ぶのと同じ関数で実行します。本物からずれていく「メモを作成」の2つ目の実装が、パレットに生えてくることはありません。

純粋なので、テストは安く済みます。ブラウザは要らず、状態を入れて行を受け取るだけです。テストは機能一覧のように読めます。たとえば「put Go to Notes first for notse and заметки」や「keep each command the server must run listed offline, dimmed with why, and dim none online」です。テストは [`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts) にあります。

管理パネルにも同じパレットがあります。そのコマンドは268行の2つ目のリストで、それ以外はすべて共有です。

## 製品は自分のレコードをどう追加する？

Seedはスターターなので、パレットは私が聞いたこともないものを見つけなければなりません。あなたの請求書、連絡先、プロジェクトです。製品はそれらをレコードとして渡します。

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

ソースは、見出しと、デバイスが今持っているレコードを返す関数の組です（[`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)）。レコードはコマンドと同じマッチャーでデバイス上で照合されるので、請求書もタイプミスや配列違いへの寛容さを、オンラインでもオフラインでも、ただで手に入れます。注意が一つあります。この関数はキー入力のたびに呼ばれるので、メモリから答えなければならず、何も変わっていない間は同じオブジェクトを返すべきです。マッチャーは各オブジェクトを一度だけ前処理し、その結果を使い回します。

## 壊してみてください

[ライブデモ](https://app.seedsaas.com/try)を開いて「Try it now」（今すぐ試す）を押してください。サンプルのメモが入ったゲストアカウントが手に入ります。それから、次を試します。

1. Ctrl+K（Macでは⌘K）を押して `notse`、次に `ntvf` と入力します。
2. `light` と入力してEnter、次に `dark` と入力してEnterを押します。
3. 誰も使っていないタイトルを入力して、Ctrl+Enterを押します。
4. ブラウザの開発者ツールでネットワークを切り、そのメモをタイプミス入りで検索します。

すべてMITライセンスで[リポジトリ](https://github.com/spy4x/seed)にあり、キーは[ショートカットのページ](/ja/features/shortcuts)に一覧があります。許すべきタイプミスを許さなかったら、それは私がまだ書いていないテストです。
