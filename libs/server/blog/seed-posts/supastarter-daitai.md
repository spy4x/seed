---
slug: supastarter-daitai
language: ja
translationOf: supastarter-alternatives
title: "Supastarter の代替は？ チーム向け SaaS ボイラープレートを無料・有料で比較"
seoTitle: "Supastarter の代替：チーム向け SaaS ボイラープレート比較"
description: Supastarter は買い切りで 349〜1,499 ドル。組織とシート課金を備えた無料・有料の代替を、出典と確認日付きで比較し、Supastarter が勝る場面も挙げます。
tldr:
  - Supastarter は Next.js・Nuxt・TanStack Start 向けの有料キットで、買い切り 349、799、1,499 ドルです。
  - Seed は MIT ライセンスの無料の代替で、グループ、ロール、Stripe のメンバー単位課金が入っています。
  - いちばん近い有料の競合は Makerkit、いちばん小さい無料の候補は Next.js SaaS Starter です。
  - Vue、Stripe 以外の決済、AI のサンプルが必要なら Supastarter を選びましょう。
topic: 質問
intro: "Supastarter は、組織、シート課金、五つの決済プロバイダーを備えた、有料 SaaS キットの中でも特に充実したひとつです。価格は 349〜1,499 ドル。チームを扱える無料・有料の代替と比べ、すべての事実に出典を付けました。"
relatedFeature: groups
coverAlt: "たくさんのオールと空いた座席がある紫色の長い手漕ぎボート。桟橋につながれ、隣には値札が白紙の灰色のヨットが停泊している。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-04T09:00:00Z
newsletter: false
---

チームに売るプロダクトで Supastarter の代わりになる主な候補は二つです。グループ、ロール、Stripe のメンバー単位課金が入った MIT ライセンスの無料ボイラープレート Seed と、299 ドルからの有料キット Makerkit です。もっと小さな無料の土台なら Next.js SaaS Starter と Open SaaS がありますが、チームか課金のどちらかは自分で作ることになります。Supastarter は買い切りで 349、799、1,499 ドル、対応する決済プロバイダーはどれよりも多いです。

私は Seed を作っているので中立ではありません。そのため、ほかの製品についての事実にはすべて出典へのリンクを付け、どのページも 2026 年 11 月 4 日に読み、Supastarter のほうが良い場面にも一節を割きました。情報が古くなっていたら [issue を立ててください](https://github.com/spy4x/seed/issues)。直します。

## Supastarter には何が入っているのか

[Supastarter](https://supastarter.dev/) は Next.js、Nuxt、TanStack Start 向けの有料ボイラープレートです。トップページには、アップデートが無期限に付く買い切りの三つの価格が並びます。

- **Solo**、349 ドル：開発者 1 人、個人プロジェクト無制限、商用利用可。
- **Startup**、799 ドル：開発者 5 人まで、チームのプロジェクト、60 分の相談、優先メールサポート。
- **Agency**、1,499 ドル：開発者 10 人まで、クライアント案件、ホワイトラベル、創業者との非公開 Discord。

中身は、Better Auth によるログイン（パスワード、パスキー、マジックリンク、OAuth、二要素認証）、招待・ロール・シート課金付きの組織、Stripe・Lemon Squeezy・Polar・Creem・Dodo Payments、ユーザーとしてログインできるスーパー管理者、多言語対応、MDX のブログとドキュメント、trigger.dev か QStash によるバックグラウンドジョブ、S3 ストレージ、Sentry、AI チャットボットのサンプルです。既定では Prisma か Drizzle が PostgreSQL の上で動き、[ドキュメント](https://supastarter.dev/docs/nextjs)には Vercel、Render、Fly.io、Netlify、Docker、Coolify、Railway へのデプロイ手順があります。

[ライセンス](https://supastarter.dev/legal/license)では、自分用でもクライアント用でも、プロダクトをいくつ作って売っても構いません。コードの再配布とライセンスの共有は禁止で、公開リポジトリには作者の許可が要ります。読んだページには返金ポリシーが見当たらなかったので、買う前に問い合わせてください。

## Supastarter と代替候補の比較表

| ボイラープレート                                               | 価格                             | ライセンス          | 技術スタック                             | チームとロール     | ホスティング                         |
| -------------------------------------------------------------- | -------------------------------- | ------------------- | ---------------------------------------- | ------------------ | ------------------------------------ |
| [Supastarter](https://supastarter.dev/)                        | 349、799、1,499 ドル             | 有料、再配布不可    | Next.js、Nuxt、TanStack Start；Postgres  | あり、シート課金   | Vercel、Docker、Coolify ほか         |
| [Seed](https://github.com/spy4x/seed)                          | 無料                             | MIT                 | Hono、Preact；Postgres                   | あり、メンバー単位 | 自分のサーバー、Docker Compose       |
| [Makerkit](https://makerkit.dev/pricing)                       | 299 か 599 ドル（定価 349、649） | 有料；Lite 版は MIT | Next.js、React Router、TanStack Start    | あり、シート課金   | Vercel 推奨；Cloudflare、Docker、VPS |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) | 無料                             | MIT                 | Next.js、Drizzle；Postgres               | Owner と Member    | Vercel                               |
| [Open SaaS](https://github.com/wasp-lang/open-saas)            | 無料                             | MIT                 | Wasp（React、Node.js、Prisma）；Postgres | 記載なし           | Railway か Fly.io、ほかどこでも      |

「記載なし」は製品のページに書かれていないという意味で、追加できないという意味ではありません。Makerkit の価格ページは 349 ドルと 649 ドルに取り消し線を引き、299 ドルと 599 ドルを請求しています。よくある質問にはまだ 349 ドルと 649 ドルと書かれています。[比較ページ](/ja/compare)には六つのボイラープレートの 19 機能を一つの表にまとめてあります。

## 日本語のプロダクトを作るなら

Seed は日本語を含む 9 言語に翻訳済みで、アプリ、管理画面、サイト、メールのすべてが日本語で動きます。Supastarter も多言語対応を掲げています。日本語訳が最初から入っているかは、買う前に確かめてください。[Stripe](https://stripe.com/global) は日本の事業者に対応しているので（2026 年 11 月 4 日確認）、Seed、Supastarter、Makerkit のどれでも課金はそのまま使えます。

## チームと課金が入った無料の Supastarter 代替はある？

あります。そしてそれこそ、無料キットの多くが空けている穴です。たいていはログインと Stripe Checkout で止まっていて、チーム、ロール、メンバー単位の価格こそ、Supastarter にお金を払うはずだった部分です。

**Seed** はその部分を備えています。登録すると一人ひとりにグループができ、閲覧者・編集者・管理者・オーナーのロールがあります。Stripe がメンバー単位で課金し、無料プラン、14 日間の試用、支払い失敗後の猶予期間も付いています。ログインはパスワード、パスキー、メールのコード、Google と GitHub、二要素目に認証アプリ。専用ドメインの管理アプリでは、人を探し、返金し、すべての操作を監査ログに残せます。Supastarter の一覧にないものとして、WebSocket によるリアルタイム更新、オフラインでも開いて変更をキューに貯めるアプリ、Compose ファイルに入ったサーバー監視（VictoriaMetrics、Grafana）とバックアップもあります。

**Next.js SaaS Starter**（GitHub スター約 16,300）は小さく正直な選択肢です。メールとパスワード、Stripe Checkout、Owner と Member のチーム。一晩で読めて、残りは自分で作れます。

**Open SaaS**（こちらもスター約 16,300）は管理画面、S3 へのアップロード、バックグラウンドジョブ、Stripe・Polar・Lemon Squeezy を備えますが、README にチームの記載はありません。

## ホスティング代はいくら上乗せされる？

ライセンスは一度払えば済みますが、ホスティングの請求は毎月来ます。Supastarter のデプロイ手順は Vercel から始まり、Supabase のようなマネージド Postgres もデータベース手順のひとつです。Seed は借りたサーバー 1 台で動きます。スライダーを動かして、Vercel Pro と Supabase Pro の組み合わせを Hetzner のサーバー上の Seed と比べてください。

<HostingCost server="cx23" developers={1} />

開発者 1 人なら、CX23 上の Seed は月 12.48 ユーロ、マネージドの組み合わせは 45 ドルです。Seed をサーバーに載せる方法は[デプロイガイド](/ja/docs/deploy)にあります。Supastarter も自分のサーバーの Docker で動くので、上の差はマネージド構成の値段であって、Supastarter の値段ではありません。

## それでも Supastarter を選ぶべきなのは

- **Vue を書く。** Supastarter には Nuxt 版があります。Seed は Preact、Makerkit は React です。
- **Stripe 以外の決済が今すぐ必要。** Supastarter は五つ。そのうち [Lemon Squeezy](https://www.lemonsqueezy.com/) と [Polar](https://polar.sh/) は merchant of record を名乗っていて、あなたに代わって販売し、税金も処理します。Seed の課金は Stripe だけで、merchant of record 型のプロバイダーは検討中のアイデア（[#584](https://github.com/spy4x/seed/issues/584)）であり、予定ではありません。
- **従量課金、ユーザーとしてのログイン、AI チャットボットのサンプルが欲しい。** Supastarter は三つとも挙げています。Seed にはどれもありません。
- **Vercel やサーバーレスにデプロイする。** Seed には自分で管理するサーバーが必要です。
- **有料の相談と、返事をくれる販売元が欲しい。** Startup と Agency には相談が付きます。Seed にあるのは GitHub の issue と私です。

Seed のリスクも量ってください。新しいプロジェクトで、メンテナーは一人です。API とワーカーは Deno、Node、Bun で動きますが（[ドキュメント](https://github.com/spy4x/seed/blob/main/docs/apps.md)）、タスクとテストにはまだ Deno が必要です。

## 349 ドル払う前に Seed を試すには

[ライブデモ](https://app.seedsaas.com)を開いてください。ワンクリックでサンプルデータ入りのゲストアカウントに入り、2 分でチームを作り、誰かを招待し、課金画面を開けます。合えば[リポジトリ](https://github.com/spy4x/seed)を clone してください。合わなければ、Supastarter は良いキットです。[ShipFast の代替](/ja/blog/shipfast-daitai)ではさらに七つを比べています。
