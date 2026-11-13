---
slug: seed-deno-node-bun-taiou
language: ja
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed が Deno・Node・Bun の3つのランタイムに対応しました"
seoTitle: "Node.js・Bun・Deno 対応の SaaS ボイラープレート Seed"
description: "無料の SaaS ボイラープレート Seed が、コードを変えずに Deno・Node.js・Bun で動くようになりました。好きなランタイムでの始め方、既存プロダクトの切り替え方、まだ Deno が必要な部分をまとめます。"
tldr:
  - Seed の API、ワーカー、マイグレーション、Web サイトは Deno・Node・Bun でそのまま起動し、CI はプルリクエストごとに3つすべてで起動を確認します。
  - env ファイルの1行 APP_RUNTIME=node または bun でサーバーのランタイムが変わります。行がなければ Deno のままなので、何もしないプロダクトもそのまま動きます。
  - 公開サイトは Fresh から、同じルート・ページ・アイランドを持つ小さなレイヤーに移りました。どのページも JavaScript が減っています。
  - タスクとテストは引き続き Deno で動きます。Deno は npm や Bun からインストールできます。
topic: 更新情報
intro: "Seed はひとつのランタイムに縛られなくなりました。サーバーは Deno・Node・Bun でコードを変えずに起動し、どれを使うかは env ファイルの1行で決まります。新しいプロダクトにとっての意味と、すでに動いているプロダクトでやることを説明します。"
coverAlt: "丘の上の鉢に植わった紫の芽と、そこへ続く3本の道。飛び石の道、木の板の道、砂利の道。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-14T09:00:00Z
newsletter: true
---

無料の SaaS ボイラープレート Seed が、Deno・Node.js・Bun のどれでも動くようになりました。API、
バックグラウンドのワーカー、データベースのマイグレーション、公開 Web サイトは、コードを1行も
変えずにそれぞれのランタイムで起動します。CI はプルリクエストごとに API・ワーカー・サイトを3つの
ランタイムすべてで起動して確認しています。プロダクトのサーバーをどのランタイムで動かすかは env
ファイルの1行で選べて、書かなければすべて Deno のままです。

この記事の読者は二人です。ひとつのランタイムにプロダクトを賭けたくなくてスターターを探している
人と、すでに Seed でプロダクトを運用していて、次の同期でこの変更を取り込む人です。各セクションが
ひとつの作業に答えます。移行そのものの経緯は、失敗も含めて
[私のブログ](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun)（英語）に書きました。

## 自分のランタイムで新しいプロダクトを始めるには？

README のクイックスタートに、ランタイムごとのセクションができました。
[Node](https://github.com/spy4x/seed#node)、[Bun](https://github.com/spy4x/seed#bun)、
[Deno](https://github.com/spy4x/seed#deno) です。必要なのは Docker と、3つのうちどれかひとつ。
Node なら次のとおりです。

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

はい、1行目で Deno をインストールしています。Deno から離れるために Deno を入れるのは我ながら
ちょっと笑えますが、Seed 自身のタスクはまだ Deno で動いています（理由は後述）。npm に `deno`
パッケージがあるので、Node しかないマシンでもほかに何も要りません。Bun の場合、1行目は
`bun add -g deno`、最後の2行は `bun run init` と `bun run dev` です。`gh` の行は省略できます。
GitHub の「Use this template」ボタンと clone で同じことができます。

これで、スタック全体が Docker 上の Deno で動きます。プロダクトのサーバーも Node や Bun で動かす
なら、`dev` の前に `infra/envs/.env` へ1行追加します。

```sh
APP_RUNTIME=node   # または bun。deno、空、行なしなら Deno のまま
```

## Node や Bun では何が動き、何が変わる？

`APP_RUNTIME=node` または `bun` にすると、API・ワーカー・マイグレーション・サイトがそれぞれ専用の
Docker イメージから Node 26 または Bun 1.4 で動きます。ポート、環境変数、サービスの起動順は
変わりません。SPA と管理画面は静的ファイルなので影響はありません。詳細は
[ドキュメントのランタイムの節](/ja/docs/apps#runtime)にあります。

切り替える前に知っておきたい、Deno との違いが3つあります。

- **ウォッチモードがない。** コードはイメージの中でバンドルされるので、Node や Bun では開発中でも
  再ビルドするまで変更が反映されません。ホットリロードでの開発は Deno のままです。
- **ワーカーにランタイムの権限制限がない。** Deno ではワーカーが読み書きできるのは画像フォルダ
  だけで、実行できるのも `vips` だけです。Node と Bun にはこの仕組みがないため、ワーカーを
  縛るのはコンテナと root ではないユーザーだけになります。
- **選ぶのはあなた。** 行がない、空、または `deno` なら、すべて Deno のままです。

## すでに Seed でプロダクトを動かしている場合は？

[プロダクトのガイド](/ja/docs/products)のとおり、いつもの方法で変更を取り込みます。Seed を
取得し、パッチを当て、コミットを記録します。

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

そのあと、プルリクエストを開く前に `deno task check` を実行します。ランタイム対応の直前の Seed の
コピーでこの同期を試したところ、パッチは衝突なしで当たりました。あなたのプロダクトでは、Seed の
ファイルを意図的に変えた箇所で衝突するかもしれません。そこはガイドのとおり、自分の版を残して
ください。

同期で入るのは、Node と Bun 用の Docker イメージ、それに切り替える Compose ファイル、ルートの
`package.json` です。使っているランタイム自体は変わりません。切り替えたくなったら、
`infra/envs/.env` に `APP_RUNTIME=node`（または `bun`）を書いてイメージを再ビルドします。

```sh
deno task compose up -d --build
```

サーバーでは、同じ行をサーバーの env ファイルに書いて、いつもどおりデプロイします
（[アップデート](/ja/docs/deploy-updates)）。デプロイのたびに、その行が指すイメージがビルドされます。

## 公開サイトでは何が変わった？

サイトは Fresh ではなく
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server) で動くようになりました。Fresh 2 の
ルート・ページ・アイランドをそのまま写した、小さなオープンソースのレイヤーです。そのためサイトの
コードはほとんど変わっていません。両方のビルドで全ルートのレスポンスを比べたところ、423件中
419件が同一でした。違った4件は、ある動画の更新日時と ETag、そして不正な形式のアドレスです。
後者は以前は素のエラーが返っていましたが、今はサイトの 404 ページが返ります。

ページも軽くなりました。ページごとの JavaScript（gzip 後）、Lighthouse のモバイル計測です。

| ページ                     | 新しいレイヤー | Fresh   |
| -------------------------- | -------------- | ------- |
| ホーム                     | 24.0 KB        | 32.1 KB |
| アイランドのあるブログ記事 | 29.9 KB        | 38.0 KB |
| ドキュメント               | 8.6 KB         | 19.4 KB |

インタラクティブなスライダーのある記事では、入力がブロックされる時間が 5 ms で、Fresh の 48 ms
を下回ります。じつはレイヤーの最初の版はまさにそこで Fresh より遅く、CI も気づきませんでした。
どう見つけたかは[移行の全記録](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun)に
あります。

プロダクトのサイトに手を入れている場合、同期後もまだ Fresh を import しているファイルが残るかも
しれません。リポジトリのルートで探せます。

```sh
grep -rlE 'from "fresh' apps/mpa
```

各 import を `@spy4x/preact-server` に向け（`fresh/runtime` も同様）、`FreshContext` を
`Context` に改名してください。ビルドフォルダは `_fresh` ではなく `dist` になりました。ページに
インラインスクリプトがなくなったので、セキュリティヘッダーにリクエストごとの nonce も不要です。
このレイヤーは最初の版です。できることと省いていることは
[レイヤーのドキュメント](https://github.com/spy4x/seed/blob/main/docs/website-server.md)にあります。

## まだ Deno が必要なのは？

ツールチェーンです。フォーマット、リンター、型チェック、テスト、`deno task` の裏にある
スクリプト。ルートの `package.json` がよく使うタスクを Deno に渡すので、`npm run test` や
`bun run dev` でも動きます。テストは引き続き Deno のテストランナーで動きます。これを変えるか
どうかは、2027年1月10日に予定している見直しで決めます
（[ランタイムのポリシー](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)）。
いずれにしても、ユーザーが触れるサーバーのランタイムが Deno に縛られることはありません。

## なぜ Seed は Deno への依存をやめたのか？

2026年10月9日、Deno チームは、バグ修正とセキュリティ修正をあと1年続け、その後は自らの開発を
終えると[発表](https://deno.com/blog/cloudflare)しました。Deno はオープンソースのまま残りますし、
私は今も Deno が好きです。ただ、ビジネスを築く土台になるスターターが、ひとつのランタイムの
ロードマップにあなたのプロダクトを賭けるべきではありません。私のロードマップも含めてです。Seed
はもともと Web 標準（Fetch、Web Crypto、WebSocket、ES モジュール）で作られていたので、難しかった
のはファイルの配信、公開シグネチャに出てくる Deno の型、そしてサイトのレイヤーで、全面的な
書き直しではありませんでした。

いつも使っているランタイムで[クイックスタート](https://github.com/spy4x/seed#quick-start)を
試してみてください。うまくいかない手順があれば、実行した内容を添えて
[issue を開いて](https://github.com/spy4x/seed/issues)ください。直します。
