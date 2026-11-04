---
slug: open-saas-daitai
language: ja
translationOf: open-saas-alternatives
title: "Open SaaS の代替は？ Wasp の無料テンプレートが合わないときの選択肢"
seoTitle: "Open SaaS（Wasp）の代替：無料・有料の SaaS スターターを比較"
description: Open SaaS は無料・MIT ライセンスで Wasp 製ですが、チーム機能がありません。チーム向けに売る、素の TypeScript を書きたい、自分のサーバーで動かしたい人のための代替を、出典付きで比較。
tldr:
  - Open SaaS は無料・MIT ライセンス。決済、管理ダッシュボード、ファイルアップロード付きで、Wasp で作られています。
  - チームや組織の機能はなく、サブスクリプションは常に 1 人のユーザーに属します。
  - チームが買うプロダクトなら、Seed（無料・MIT）か、有料の Makerkit・Supastarter を検討しましょう。
  - 個人が買うプロダクト、コマンド一つのデプロイ、Polar や Paddle が必要なら Open SaaS のままで十分です。
topic: 質問
intro: "Open SaaS は無料の SaaS テンプレートの中でも本当に優れたものです。ただし、1 人に 1 サブスクリプションという設計と Wasp フレームワークという二つを、最初から決めてしまいます。どちらかが合わないときに何を選ぶかをまとめました。"
relatedFeature: groups
coverAlt: "扉の開いたガラスの温室。中には紫の植物が育つ大きな共用プランターがあり、扉の横には小さな鉢が五つ並んでいる。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Open SaaS は無料の SaaS テンプレートの中でも特に充実したものです。MIT ライセンスで GitHub のスターは約 16,250、決済・管理ダッシュボード・ファイルアップロードが最初から入っています。代替が必要になるのは三つの場合です。チームに売る（Open SaaS には組織機能がない）、Wasp フレームワークの上に作りたくない、自分のサーバーで動かしたい。そのときは Seed（無料・MIT、チームとメンバー単位の課金付き）か、有料の Makerkit と Supastarter を見てください。

私は Seed の開発者なので中立ではありません。ほかの製品についての事実はすべて出典にリンクし、2026 年 11 月 4 日に確認しました。古くなった情報があれば [issue で教えてください](https://github.com/spy4x/seed/issues)。すぐ直します。

## Open SaaS には何が入っているのか

[Open SaaS](https://github.com/wasp-lang/open-saas) は Wasp フレームワークのチームが作る無料テンプレートです。README には、無料とは思えないほど多くの機能が並んでいます。

- メール認証付きのメール登録。Google、GitHub、Discord は[認証設定](https://github.com/wasp-lang/open-saas/blob/main/template/app/src/auth/auth.wasp.ts)で有効にできます。
- Stripe、Polar、Lemon Squeezy での決済。コードには Paddle の連携もあります。
- shadcn/ui の管理ダッシュボード、AWS S3 へのファイルアップロード、SendGrid・Mailgun・SMTP でのメール送信。
- Plausible または Google Analytics、OpenAI のデモアプリ、Astro のドキュメントサイトとブログ、Playwright の E2E テスト。
- AI コーディングエージェント向けのルール、スキル、Claude Code プラグイン。

開発も活発で、最新のコミットは 2026 年 10 月 28 日です。

ないのはチーム機能です。[データベーススキーマ](https://github.com/wasp-lang/open-saas/blob/main/template/app/schema.prisma)には `isAdmin` フラグを持つ `User` があるだけで、チームや組織のモデルはありません。つまりサブスクリプションは 1 人に属します。個人が自分のために買うツールならこれで正解です。B2B プロダクトなら、チーム、招待、ロール、席数課金を作るのが最初の数週間の仕事になります。

## Wasp の上に作るとはどういうことか

Wasp はフルスタックフレームワークです。ページ、ルート、ログイン、ジョブ、サーバー処理を `main.wasp.ts` という一つのファイルに書くと、Wasp が React・Node.js・Prisma のアプリを組み立てます（[Wasp のドキュメント](https://wasp.sh/docs)）。配線のコードを大幅に減らせるのが最大の利点です。

その代わり、アプリはフレームワークの形に沿います。独自の仕様を覚え、フレームワークの更新に合わせて自分も更新します。また Wasp はまだ 1.0 前で、最新リリースは [2026 年 10 月 23 日の 0.26.1](https://github.com/wasp-lang/wasp/releases) です。それで満足しているチームはたくさんあります。ただ、なんとなくではなく、意識して選んでください。

デプロイは簡単です。`wasp deploy` を一回実行すれば、データベース・サーバー・クライアントが Fly.io か Railway に載ります。手動なら任意のホスティングにも置けます（[デプロイガイド](https://docs.opensaas.sh/guides/deploying/)）。ガイドには Docker の記載はありません。

## 代替を並べて比較

| 機能           | Open SaaS                        | Seed                             | Makerkit                         | Supastarter                     |
| -------------- | -------------------------------- | -------------------------------- | -------------------------------- | ------------------------------- |
| 価格           | 無料                             | 無料                             | 買い切り 299 ドルまたは 599 ドル | 買い切り 349〜1,499 ドル        |
| ライセンス     | MIT                              | MIT                              | 有料。Lite キットは MIT          | 有料                            |
| 技術スタック   | Wasp（React、Node.js、Prisma）   | Hono、Preact、Postgres           | Next.js 16、TanStack Start ほか  | Next.js、Nuxt、TanStack Start   |
| チームとロール | なし                             | あり（閲覧者からオーナーまで）   | あり（招待と権限付き）           | あり（招待とロール付き）        |
| 決済           | Stripe、Polar、Lemon Squeezy     | Stripe、メンバー単位の課金       | 未確認                           | Stripe、Lemon Squeezy ほか 3 社 |
| 管理画面       | 管理ダッシュボード               | 専用ホストの管理アプリ、監査ログ | Lite キットにはなし              | 未確認                          |
| ホスティング   | Fly.io か Railway にコマンド一つ | 自分のサーバーで Docker Compose  | 未確認                           | Vercel、サーバーレス、Docker    |

出典：[Open SaaS の README](https://github.com/wasp-lang/open-saas)、[Makerkit の価格](https://makerkit.dev/pricing)、[Supastarter](https://supastarter.dev/)、[Seed の README](https://github.com/spy4x/seed)。Makerkit の価格は割引後のもので、定価は 349 ドルと 649 ドルです。「未確認」は、私が読んだページに記載が見つからなかったという意味で、機能がないという意味ではありません。

## チーム向けプロダクトに合う代替は？

まさにこのために Seed を作りました。登録すると全員にグループができ、グループには閲覧者からオーナーまでのロールとメールでの招待があります。Stripe の課金はメンバー単位で、数量はメンバー数に合わせて変わります。無料プラン、14 日間のトライアル、支払い失敗後の猶予期間もあります（[課金のドキュメント](https://github.com/spy4x/seed/blob/main/docs/billing.md)）。仕組みは[グループのページ](/ja/features/groups)で見られます。

ほかの土台もできています。

- パスワード、パスキー、Google、GitHub、メールのコードでのログイン、ゲストアカウント、認証アプリによる二要素認証。
- 専用ホストで動く管理アプリ。すべての操作は監査ログに残ります。
- WebSocket によるリアルタイム更新と、オフラインでも開いて変更を保存できるアプリ。
- ファイルストレージ、右から左に書くアラビア語を含む 9 言語、Compose ファイルに入ったバックアップと監視。

コードは Hono と Preact の素の TypeScript で、あなたとコードの間に仕様ファイルやコード生成はありません。借りた 1 台のサーバーで Docker Compose で動くので、費用は毎月の固定額です。

有料キットでは、**Makerkit** と **Supastarter** のどちらにも招待とロール付きの組織機能があり、Supastarter は席数で課金できます。無料版の Makerkit Lite にはチームも課金もありません。

## Open SaaS のほうが良いのはどんなとき？

- 個人に売るプロダクトで、決済・管理ダッシュボード・ファイルアップロードを今日、無料で使いたい。
- Wasp の考え方が好き：仕様ファイル一つで、配線のコードがずっと少ない。
- Polar、Lemon Squeezy、Paddle を使いたい。Seed の決済は Stripe だけで、Merchant of Record 型の決済代行は検討中のアイデア（[#584](https://github.com/spy4x/seed/issues/584)）であり、計画ではありません。
- 自分でサーバーを管理せず、Fly.io や Railway にコマンド一つでデプロイしたい。
- 大きなコミュニティが欲しい：Wasp には [Discord](https://discord.gg/rzdnErX) があり、Open SaaS は GitHub のスター数で Seed をはるかに上回ります。

Seed のリスクも正直に書いておきます。まだ若いプロジェクトで、メンテナーは 1 人です。API とワーカーは env ファイルの 1 行で Node や Bun でも動きます（[ランタイムについて](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)）が、Web サイトとツール類にはまだ Deno が必要です。Android アプリとデスクトップアプリは[まだありません](https://github.com/spy4x/seed/issues/202)。

## 半日で比べるには？

1. README のとおり `wasp new -t saas` で Open SaaS のアプリを作る。
2. Seed の[ライブデモ](https://app.seedsaas.com)を開く。ワンクリックでサンプルデータ入りのゲストアカウントに入れます。
3. どちらでも、顧客が初日にやることを試す。顧客がチームで来るなら、同僚を招待して課金画面を開いてみてください。

ほかの比較記事もあります。[ShipFast の代替](/ja/blog/shipfast-daitai)では 7 つのボイラープレートを一つの表にまとめ、[無料の SaaS ボイラープレートのガイド](/ja/blog/saas-boilerplate-muryo)では無料のスターターに最初から入っているべきものを説明しています。Seed が合いそうなら、[リポジトリ](https://github.com/spy4x/seed)をクローンするだけです。
