---
slug: makerkit-daitai
language: ja
translationOf: makerkit-alternatives
title: "Makerkit の代替は？ 無料の SaaS ボイラープレートと、お金を払うべき場面"
seoTitle: "Makerkit の代替：無料・オープンソースの SaaS ボイラープレート"
description: Makerkit は 299 ドルから。無料の Lite には課金もチームもありません。両方を備えた無料の代替を出典付きで紹介し、Makerkit に払う価値がある場面も挙げます。
tldr:
  - Makerkit の有料キットは買い切りで 299 か 599 ドル。無料の Lite には課金、チーム、管理画面がありません。
  - 有料キットで作ったプロジェクトはオープンソースにできず、フリーランスはクライアントごとにライセンスが要ります。
  - Seed は無料の MIT で、チーム、メンバー単位の課金、管理アプリを備え、自分のサーバーで動きます。
  - Supabase、Next.js、React Router、コーディングエージェント向けのツールが欲しいなら Makerkit を選びましょう。
topic: 質問
intro: "Makerkit は丁寧に作られた有料キットで、無料の Lite 版もあります。そして両者の差は、チーム向けプロダクトに必要なものそのものです。その差を埋める無料の代替を出典付きで紹介し、Makerkit に払うのが正解になる場面も挙げます。"
relatedFeature: deploy
coverAlt: "トレイいっぱいに道具が入った、開いた大きな紫色の工具箱。隣には南京錠の掛かった小さな灰色の工具箱。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Makerkit の有料キットが加えるもの、つまりチーム、課金、管理画面を残したまま無料で使える代替は Seed です。グループとロール、Stripe のメンバー単位課金、専用ドメインの管理アプリを備えた MIT ライセンスのボイラープレートです。Makerkit 自身の無料キット Lite は、この三つを外しています。もっと小さな無料の土台なら Next.js SaaS Starter、有料なら Supastarter があります。Makerkit の有料キットは買い切りで 299 か 599 ドルです。

私は Seed を作っているので、そのつもりで読んでください。ほかの製品についての事実にはすべて出典へのリンクを付け、どのページも 2026 年 11 月 4 日に読みました。変わっていたら [issue を立ててください](https://github.com/spy4x/seed/issues)。直します。

## Makerkit には何があり、Lite には何がないのか

[Makerkit](https://makerkit.dev/) は三つのデータ層（Supabase、Drizzle と Better Auth、Prisma と Better Auth）の上に、Next.js 16、TanStack Start、そして Supabase 版では React Router 8 向けのキットを用意しています。トップページに並ぶのは、パスワード・マジックリンク・任意のパスキー・OAuth・認証アプリによるログイン、ロールと招待付きのチームアカウント、定額・シート単位・従量の Stripe サブスクリプション、ユーザーとしてログインしたり利用停止にしたりできるスーパー管理者、多言語対応、ブログとドキュメント、Supabase キットのリアルタイム通知です。コーディングエージェント向けには、ルール、スキル、MCP サーバーが付きます。

[料金ページ](https://makerkit.dev/pricing)には、アップデートが無期限に付く買い切りのライセンスが二つあります。

- **Pro**、349 ドル（キットのカードでは 299 ドル）：開発者 1 人、プロジェクト無制限。
- **Teams**、649 ドル（カードでは 599 ドル）：リポジトリに 5 人まで。

買う前に規約を読んでください。意外な点が二つあります。フリーランスはクライアントごとに別のライセンスが必要です。そして有料キットで作ったプロジェクトはオープンソースとして公開できず、その用途には Lite を使うよう案内されています。アクセスを得た後の返金は原則として行われないので、料金ページ自身が先に Lite を試すよう勧めています。

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) は無料で MIT、GitHub スターは約 470。Next.js、Supabase のログイン、プロフィールページ、多言語対応、マーケティングページが入っています。README には外したものが書かれていて、その一覧こそチーム向けプロダクトの中心部です。課金、チームアカウント、メールテンプレート、スーパー管理画面、ブログとドキュメント。

## Makerkit と代替候補の比較表

| ボイラープレート                                                          | 価格                                      | ライセンス                                 | 技術スタック                          | チームと課金                     | ホスティング                         |
| ------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------- | -------------------------------- | ------------------------------------ |
| [Makerkit](https://makerkit.dev/pricing)                                  | 買い切り 299 か 599 ドル（定価 349、649） | 有料、オープンソース不可、クライアントごと | Next.js、React Router、TanStack Start | あり、シート単位                 | Vercel 推奨；Cloudflare、Docker、VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | 無料                                      | MIT                                        | Next.js、Supabase                     | なし                             | 記載なし                             |
| [Seed](https://github.com/spy4x/seed)                                     | 無料                                      | MIT                                        | Hono、Preact；Postgres                | あり、メンバー単位               | 自分のサーバー、Docker Compose       |
| [Supastarter](https://supastarter.dev/)                                   | 買い切り 349、799、1,499 ドル             | 有料、再配布不可                           | Next.js、Nuxt、TanStack Start         | あり、シート単位                 | Vercel、Docker、Coolify ほか         |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | 無料                                      | MIT                                        | Next.js、Drizzle；Postgres            | Owner と Member；Stripe Checkout | Vercel                               |

Makerkit のホスティング欄は[本番環境チェックリスト](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist)によるもので、Vercel を推奨し、Docker や VPS は「より多くの設定が必要」としています。[比較ページ](/ja/compare)には六つのボイラープレートの 19 機能を並べてあります。

## 日本語のプロダクトを作るなら

Seed は日本語を含む 9 言語に翻訳済みで、アプリ、管理画面、サイト、メールまで日本語で動きます。Makerkit も多言語対応を掲げています。日本語訳が最初から入っているかは、買う前に確かめてください。[Stripe](https://stripe.com/global) は日本の事業者に対応しています（2026 年 11 月 4 日確認）。

## Makerkit Lite に足りないものを備えた無料の代替は？

**Seed** には三つともあります。登録すると一人ひとりにグループができ、閲覧者・編集者・管理者・オーナーのロールがあります。Stripe がメンバー単位で課金し、無料プラン、14 日間の試用、支払い失敗後の猶予期間も付いています。専用ドメインの管理アプリでは、人を探し、返金し、すべての操作を監査ログに残せます。ログインはパスワード、パスキー、メールのコード、Google と GitHub、二要素目に認証アプリ。さらに Makerkit のどのページにも書かれていないものとして、オフラインでも開いて変更をキューに貯めるアプリと、Compose ファイルに入ったサーバー監視（VictoriaMetrics、Grafana）とバックアップがあります。

Seed は MIT なので、ライセンスの二つの驚きはありません。プロダクトをオープンソースで公開しても、クライアント案件を十件作っても、二つ目のライセンスは誰にも要りません。私自身、クライアントの MVP を Seed の上で作っているので、これは机上の話ではありません。

**Next.js SaaS Starter**（スター約 16,300）は Lite と有料キットの中間です。Owner と Member のチーム、Next.js・Drizzle・Postgres 上の Stripe Checkout と Customer Portal があり、管理画面はありません。

## ホスティング代は別にいくらかかる？

Makerkit のチェックリストは Vercel を推奨し、主力キットは Supabase の上で動きます。この組み合わせは毎月、開発者のシートとデータベースごとに請求されます。Seed は借りたサーバー 1 台で動きます。サーバーとチームの人数を選んでください。

<HostingCost server="cx23" developers={1} />

開発者 1 人なら、CX23 上の Seed は月 12.48 ユーロ、Vercel Pro と Supabase Pro は 45 ドルです。条件が同じ比較ではありません。マネージドの組み合わせは更新、拡張、バックアップを代わりにやってくれます。Seed をサーバーに載せる方法は[デプロイガイド](/ja/docs/deploy)にあります。

## Makerkit にお金を払う価値があるのは

- **Supabase を使いたい。** Makerkit の主力キットは Supabase の認証、ストレージ、row-level security に乗っています。Seed は独自の Postgres とログインを持っています。
- **Next.js か React Router を使いたい。** Seed は公開サイトも含めてすべて Preact です。
- **ユーザーとしてのログイン、従量課金、二つ目の決済プロバイダーが必要。** Makerkit は前の二つを挙げ、トップページでは Stripe と並んで Polar の名前も出しています。Seed には三つともなく、決済は Stripe だけです。
- **コーディングエージェントと一緒に働く。** Makerkit には MCP サーバーとスキルがあります。Seed には[エージェント向けの手引き](/ja/docs/ai-agents)がありますが、MCP サーバーはありません（[#211](https://github.com/spy4x/seed/issues/211)）。
- **実績のあるメンテナーが欲しい。** Makerkit は 2022 年からフルタイムで保守していると述べています。Seed は新しく、メンテナーは私一人です。

## 決める前に Seed を試すには

[ライブデモ](https://app.seedsaas.com)を開いてください。ワンクリックでサンプルデータ入りのゲストアカウントが開き、2 分でチームを作り、誰かを招待し、課金画面を開けます。それから[リポジトリ](https://github.com/spy4x/seed)を clone してください。Makerkit のほうが合いそうなら、料金ページの勧めどおり Lite から始めましょう。ほかの選択肢は [Supastarter の代替](/ja/blog/supastarter-daitai)にあります。
