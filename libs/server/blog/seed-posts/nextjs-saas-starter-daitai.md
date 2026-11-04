---
slug: nextjs-saas-starter-daitai
language: ja
translationOf: nextjs-saas-starter-alternatives
title: "Next.js SaaS Starter の代替は？ 物足りなくなったときの選択肢"
seoTitle: "Next.js SaaS Starter の代替：無料・有料のスターターを比較"
description: Next.js SaaS Starter は無料で、あえて小さく作られています。パスワードリセットも招待メールもありません。それらが最初から入った無料・有料の代替を、出典付きで比較。
tldr:
  - Next.js SaaS Starter は無料・MIT ライセンス。オーナーとメンバーのチーム機能と Stripe Checkout があります。
  - メールを一通も送らないので、招待、パスワードリセット、メールアドレスの確認は自分で作る必要があります。
  - それらが揃って無料なのは Seed。Next.js のままもっと揃えたいなら Makerkit か Supastarter です。
  - 学習用の小さなコードが欲しい、ログインを自分流に作りたいなら、このスターターのままで十分です。
topic: 質問
intro: "Next.js SaaS Starter はきれいで小さな土台で、README 自身が学習用だと書いています。足りないものと、それらを最初から揃えたいときに選ぶべきスターターをまとめました。"
relatedFeature: sign-in
coverAlt: "一本の芽を囲む小さな木の枠と、その奥に紫の植物でいっぱいの完成したガラスの温室。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Next.js SaaS Starter は MIT ライセンスの無料テンプレートで、メールとパスワードのログイン、Stripe Checkout、オーナーとメンバーのロールを持つチーム機能が入っています。README では、意図的に最小限にした学習用のリソースだと説明されています。もっと多くを最初から揃えたいときの代替は二つの方向です。Seed は無料・MIT で、招待、パスワードリセット、パスキー、メンバー単位の課金まで揃っています。Makerkit と Supastarter は Next.js のまま使える有料キットです。

私は Seed の開発者なので、その前提で読んでください。ほかの製品についての事実はすべて出典にリンクし、2026 年 11 月 4 日に確認しました。古くなった情報があれば [issue で教えてください](https://github.com/spy4x/seed/issues)。すぐ直します。

## Next.js SaaS Starter には何が入っているのか

[Next.js SaaS Starter](https://github.com/nextjs/saas-starter) は GitHub の Next.js 組織にあるリポジトリで、コミットの大半は Lee Robinson 氏によるものです。スターは約 16,250。README に並ぶ機能は次のとおりです。

- ランディングページと、Stripe Checkout を開く料金ページ。
- メールとパスワードのログイン（JWT を Cookie に保存）。
- チームと、オーナー・メンバーのロールを扱うダッシュボード。
- Stripe の Customer Portal でのサブスクリプション管理。
- ユーザー操作のアクティビティログ。

技術スタックは Next.js、Drizzle を使った Postgres、shadcn/ui。午後のうちに全部読めるのが狙いです。

## 何が足りないのか

メールを送りません。`package.json` にメールのライブラリはなく、メンバーを招待しても招待はデータベースに保存されるだけで送信されません。コードにもそう書いてあります：[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454)。パスワードリセットとメールアドレスの確認もコードにはありません。

ログインはメールとパスワードだけで、Google、GitHub、パスキー、二要素認証はありません。

課金はチームごとに一つのサブスクリプションです。Checkout は数量 1、14 日間のトライアルで始まり、数量は誰かが Customer Portal で変更したときにしか変わりません（[stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)）。メンバーを追加しても請求額は変わりません。

更新もゆっくりです。最近の 2 件のコミットは 2025 年 12 月 8 日と 11 日で、どちらも Next.js のセキュリティ更新です。2 件目は CVE-2025-55182 の修正のために Next.js `15.6.0-canary.59` へ上げたもの。その前は 2025 年 6 月でした。

スターターが名乗っている役割から見れば、どれも欠点ではありません。お金を払うチームが最初に必要とする部分は、自分で書くことになる、というだけです。

## 代替を並べて比較

| 機能           | Next.js SaaS Starter     | Seed                            | Open SaaS                    | Makerkit                         | Supastarter                     |
| -------------- | ------------------------ | ------------------------------- | ---------------------------- | -------------------------------- | ------------------------------- |
| 価格           | 無料                     | 無料                            | 無料                         | 買い切り 299 ドルまたは 599 ドル | 買い切り 349〜1,499 ドル        |
| ライセンス     | MIT                      | MIT                             | MIT                          | 有料。Lite キットは MIT          | 有料                            |
| 技術スタック   | Next.js、Drizzle         | Hono、Preact、Postgres          | Wasp（React、Node.js）       | Next.js 16、TanStack Start ほか  | Next.js、Nuxt、TanStack Start   |
| チームとロール | オーナーとメンバー       | 閲覧者からオーナーまで          | なし                         | あり（招待付き）                 | あり（招待付き）                |
| 招待メール     | 送信されない             | あり                            | チーム機能なし               | 未確認                           | 未確認                          |
| 課金           | Stripe、チームごとに一つ | Stripe、メンバー単位            | Stripe、Polar、Lemon Squeezy | 未確認                           | Stripe、Lemon Squeezy ほか 3 社 |
| ホスティング   | Vercel                   | 自分のサーバーで Docker Compose | Fly.io か Railway            | 未確認                           | Vercel、サーバーレス、Docker    |

出典：[Next.js SaaS Starter](https://github.com/nextjs/saas-starter)、[Open SaaS](https://github.com/wasp-lang/open-saas)、[Makerkit の価格](https://makerkit.dev/pricing)、[Supastarter](https://supastarter.dev/)、[Seed の README](https://github.com/spy4x/seed)。Makerkit の価格は割引後のもので、定価は 349 ドルと 649 ドルです。「未確認」は、私が読んだページに記載が見つからなかったという意味で、機能がないという意味ではありません。

## どの代替を選ぶべきか

**Next.js のまま、もっと揃ったものが欲しい。** Makerkit か Supastarter を購入しましょう。どちらも招待とロール付きの組織機能があり、Supastarter は席数課金と 5 つの決済サービスに対応しています。Makerkit Lite は無料・MIT ですが、チームも課金もありません。

**無料で、チーム機能まで揃っていてほしい。** それが Seed です。アカウントごとにグループがあり、ロールは閲覧者からオーナーまで。招待はメールで届き、Stripe の課金はメンバー単位で、数量はメンバー数に合わせて変わります。無料プラン、14 日間のトライアル、支払い失敗後の猶予期間もあります。ログインも揃っています：確認コード付きのパスワード、パスキー、Google、GitHub、メールのログインコード、ゲストアカウント、認証アプリによる二要素認証（[Seed のログイン機能](/ja/features/sign-in)）。さらに監査ログ付きの管理アプリ、リアルタイム更新、オフライン対応アプリ、9 言語。代わりに、Next.js ではなく Hono と Preact です。

**個人に売るプロダクトで、配線はフレームワークに任せたい。** Open SaaS を見てください。[Open SaaS の代替](/ja/blog/open-saas-daitai)についても書きました。

## ホスティング費用は？ Vercel か、サーバー 1 台か

スターターの README は Vercel にデプロイし、Postgres は任意の接続 URL を使います。Seed は借りたサーバー 1 台で動きます。よくある組み合わせとして Vercel Pro と Supabase Pro を例に、両方を並べました。サーバーを選び、チームに合わせてスライダーを動かしてみてください。

<HostingCost server="cx23" developers={1} />

開発者 1 人なら、Hetzner CX23 上の Seed は月 12.48 ユーロ、マネージドの組み合わせは 45 ドルで、2026 年 11 月 2 日の欧州中央銀行のレートで約 40.12 ユーロです。同じ条件の比較ではありません。マネージドならサーバーの更新は不要で、データベースのバックアップも任せられます。すべての価格と出典を載せた計算は [SaaS を Hetzner のサーバー 1 台にデプロイする](/blog/deploy-saas-to-one-hetzner-server)（英語）にあります。

## それでも Next.js SaaS Starter が良いのはどんなとき？

- 全部読み切れる小さなコードで App Router と Server Actions を学びたい。
- ログインと課金は自分流に作るので、消すものはできるだけ少ないほうがいい。
- チームが Next.js と React に慣れていて、Vercel にデプロイする。

Seed のリスクも書いておきます。まだ若く、メンテナーは 1 人です。API とワーカーは env ファイルの 1 行で Node や Bun でも動きます（[ランタイムについて](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)）が、Web サイトとツール類にはまだ Deno が必要です。

## 決める前に Seed を試すには？

[ライブデモ](https://app.seedsaas.com)を開いてください。ワンクリックでサンプルデータ入りのゲストアカウントに入れます。同僚を招待して課金画面を開けば、Next.js のスターターが自分任せにしている部分をそのまま確かめられます。合いそうなら[リポジトリ](https://github.com/spy4x/seed)をクローンしてください。もっと広く比べたいなら、[ShipFast の代替](/ja/blog/shipfast-daitai)で 7 つのボイラープレートを一つの表にまとめています。
