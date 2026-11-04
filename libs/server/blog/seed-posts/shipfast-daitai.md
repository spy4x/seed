---
slug: shipfast-daitai
language: ja
translationOf: shipfast-alternatives
title: "ShipFast の代替は？ 無料・有料の SaaS ボイラープレート 7 つを比較"
seoTitle: "ShipFast の代替：SaaS ボイラープレート 7 つを比較"
description: ShipFast の代わりになる SaaS ボイラープレートを、価格・ライセンス・技術スタック・チーム機能・ホスティング・日本語対応で比較。すべての情報に出典と確認日付き。
tldr:
  - ShipFast は買い切りで 199〜299 ドル。1 人のユーザーが払うプロダクトに向いています。
  - 無料で MIT ライセンスなら、Seed、Open SaaS、ShipFree、Next.js SaaS Starter があります。
  - 顧客がチームなら、グループ・ロール・メンバー単位の課金が最初から入ったものを選びましょう。
  - ShipFast は翻訳機能を掲げていません。Seed は日本語を含む 9 言語に対応しています。
topic: 質問
intro: "ShipFast は良いキットですが、唯一の選択肢ではなく、無料でもありません。七つのボイラープレートを価格、ライセンス、技術スタック、チーム機能、ホスティングで比べ、すべての事実に出典を付けました。"
coverAlt: "静かな水面に並ぶ形の違う七艘の帆船、そのうち一艘は紫色。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T09:00:00Z
newsletter: false
---

ShipFast の主な代替は、MIT ライセンスの無料スターター（Seed、Open SaaS、ShipFree、Next.js SaaS Starter、Ixartz の SaaS Boilerplate）と、より高価な有料キット（Makerkit、Supastarter）です。どれが ShipFast より合うかは、ひとつの質問で決まります。お金を払うのは個人ですか、それともチームですか。ShipFast は前者向けに作られていて、ほかの選択肢は後者をどこまで用意しているかで違いが出ます。

私は 7 つのうちのひとつ、Seed の開発者なので、中立ではありません。だからこそ、ほかの製品についての事実はすべて出典ページにリンクし、ShipFast を選ぶべき場合も正直に書きました。各ページは 2026 年 11 月 3 日に確認しています。古くなった情報があれば [issue で教えてください](https://github.com/spy4x/seed/issues)。すぐ直します。

## ShipFast には何が入っているのか

ShipFast は Marc Lou 氏による Next.js のボイラープレートです。[販売ページ](https://shipfa.st/)によると、Starter が 199 ドル、All-in が 249 ドルの買い切りで、講座 CodeFast 付きは 299 ドルです。Google またはマジックリンクでのログイン（NextAuth）、MongoDB か Supabase、Stripe か Lemon Squeezy での決済、Mailgun か Resend でのメール送信、ブログと SEO 用の仕組みが入っています。

[ライセンス](https://shipfa.st/license)では商用を含めてプロジェクト数は無制限ですが、テンプレート自体の再販売や再配布は禁止で、コードの権利は ShipFast 側に残ります。オープンソース化については記載がないので、公開する前に確認してください。

販売ページに載っていないもの：グループや組織、ロール、二要素認証、パスキー、管理画面、多言語対応。個人向けのツールなら困らないかもしれません。B2B なら、それだけで最初の 1 か月分の作業です。

## ShipFast と代替候補の比較表

| テンプレート                                                          | 価格                            | ライセンス          | 技術スタック                             | チームとロール             | ホスティング                               |
| --------------------------------------------------------------------- | ------------------------------- | ------------------- | ---------------------------------------- | -------------------------- | ------------------------------------------ |
| [ShipFast](https://shipfa.st/)                                        | 199 または 249 ドル（買い切り） | 有料、再配布不可    | Next.js、MongoDB または Supabase         | 記載なし                   | 無料の選択肢として Vercel                  |
| [Seed](https://github.com/spy4x/seed)                                 | 無料                            | MIT                 | Deno、Hono、Fresh、Preact、Postgres      | あり（メンバー単位の課金） | 自前の Linux サーバー 1 台、Docker Compose |
| [Open SaaS](https://github.com/wasp-lang/open-saas)                   | 無料                            | MIT                 | Wasp（React、Node.js、Prisma）、Postgres | 記載なし                   | Railway か Fly.io にコマンド 1 つ          |
| [ShipFree](https://github.com/revokslab/shipfree)                     | 無料                            | MIT                 | Next.js、Bun、Drizzle、Postgres          | 記載なし                   | Vercel または Docker                       |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)        | 無料                            | MIT                 | Next.js、Drizzle、Postgres               | Owner と Member            | Vercel                                     |
| [Ixartz SaaS Boilerplate](https://github.com/ixartz/SaaS-Boilerplate) | 無料（有料版あり）              | MIT（無料版）       | Next.js、Clerk、Drizzle                  | あり                       | 記載なし、Node.js 24 以上                  |
| [Makerkit](https://makerkit.dev/pricing)                              | 299 または 599 ドル（買い切り） | 有料（Lite は MIT） | Next.js、React Router、TanStack Start    | あり                       | 記載なし                                   |
| [Supastarter](https://supastarter.dev/)                               | 349〜1,499 ドル（買い切り）     | 有料                | Next.js、Nuxt、TanStack Start            | あり（席数課金）           | Vercel、サーバーレス、Docker               |

「記載なし」は、その製品のページに書かれていないという意味で、追加できないという意味ではありません。Makerkit は割引後の価格で、定価は 349 ドルと 649 ドルです。Ixartz の無料版には Stripe がなく、決済は有料版の Pro と Max に含まれます。

## 日本語のプロダクトを作るなら

日本のユーザー向けなら、翻訳の仕組みが最初からあるかどうかで手間が大きく変わります。ShipFast の販売ページは多言語対応を掲げていません。ShipFree は英語・フランス語・スペイン語です。Seed はアプリ、管理画面、Web サイト、メールまで 9 言語に対応していて、日本語も含まれます。

決済については、Stripe は[日本の事業者に対応](https://stripe.com/global)しています。Seed の決済は Stripe のみです。

## ShipFast にいちばん近い無料の代替は？

**ShipFree** は発想をもっとも素直に受け継いだものです。ShipFast の代替を名乗る無料の Next.js キットで、現在は Bun、Drizzle、Better Auth を使い、Stripe に加えて 5 つの決済サービスに対応しています。GitHub のスターは約 1,700 です。

**Open SaaS** はこの中でもっとも人気のある無料テンプレートで、スターは約 16,200 です。Wasp フレームワーク上に作られ、管理ダッシュボード、S3 へのファイルアップロード、Stripe・Polar・ Lemon Squeezy、ドキュメントサイトが付いています。

**Next.js SaaS Starter** も約 16,200 スターで、あえて小さく作られています。メールでのログイン、Stripe Checkout、Owner と Member のロールを持つチーム。午後のうちに読み切れる量です。

## 顧客がチームの場合はどれを選ぶ？

Seed がもっとも強いのはここです。登録したユーザーには必ずグループができ、グループには閲覧者から所有者までのロールがあり、Stripe がメンバー単位で課金するので、料金はチームの人数についていきます。ログインは完成しています。パスワード、パスキー、メールのサインインリンク、Google と GitHub、認証アプリによる二要素認証。専用ドメインの管理画面では、ユーザーを探し、返金し、すべての操作を監査ログに残せます。アプリはオフラインでも動き、リアルタイムで更新されます。

すべてが借りたサーバー 1 台の上で、Postgres や監視と一緒に Docker Compose で動くので、費用はトラフィックで増える従量課金ではなく毎月の固定額です。Seed は無料の MIT ライセンスで、作ったものは販売もフォークも公開も自由です。[完全な比較表](/ja/compare)では 6 つのスターターを 19 の機能で比べています。有料キットでは **Supastarter** と **Makerkit** も組織機能を持っています。

## それでも ShipFast を選ぶべきなのは

- Next.js と React で開発していて、そのエコシステムから離れたくない。
- 個人向けに売るもので、ランディングページ・決済・ブログを今週末に公開したい。
- 大きなコミュニティがほしい。Discord（販売ページによれば 5,000 人以上）と講座も購入に含まれます。
- 今すぐ Lemon Squeezy が必要。Seed は Stripe のみで、merchant of record 型の決済サービスは検討中のアイデア（[#584](https://github.com/spy4x/seed/issues/584)）にすぎません。
- Vercel やサーバーレス関数にデプロイしたい。Seed には自分で管理するサーバーが必要です。

Seed のリスクも正直に書いておきます。始まったばかりのプロジェクトでメンテナーは 1 人、現時点では Deno で動いていて、Node.js と Bun への対応はこれからです。

## 10 分で決める手順

1. 誰が払うかを書き出す。個人か、管理者のいるチームか。
2. チームなら、比較表からグループとロールのないものを消す。
3. 日本語化と決済の手間を見積もる。
4. 1 円でも払う前に、デモかリポジトリを開いて実際に登録してみる。

Seed のデモは、架空の人物とデータで動く「初日に手に入るアプリ」そのものです。[app.seedsaas.com で試してから](https://app.seedsaas.com)、[運用にかかる費用](/ja/pricing)も確認してみてください。
