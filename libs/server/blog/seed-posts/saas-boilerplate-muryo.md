---
slug: saas-boilerplate-muryo
language: ja
translationOf: free-saas-boilerplate
title: 無料でオープンソースのSaaSボイラープレートはある？7つを正直に比較
seoTitle: "無料のSaaSボイラープレート：オープンソース7選を比較"
description: あります。Seed、Open SaaS、Next.js SaaS Starter、ixartz、Apptension、BoxyHQ、Makerkit Liteは無料でオープンソース。それぞれの中身と日本語対応、向いている場面をまとめました。
tldr:
  - 無料でオープンソースのSaaSボイラープレートは複数あり、ログイン・決済・管理画面まで揃うものもあります。
  - 有料キットの無料版は、決済やチーム機能が省かれていることが多いです。
  - 日本語の翻訳まで最初から入っているのは、7つのうちSeedだけでした（2026年11月3日、各リポジトリで確認）。
  - Seedはロール付きグループ、メンバー単位のStripe課金、管理画面、9言語を自分のサーバーで動かせます。
topic: 質問
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

あります。無料でオープンソースのSaaSボイラープレート（スターターキット）は複数あり、良いものはログイン、決済、ダッシュボードまで最初から入っています。2026年11月3日時点で、Seed、Open SaaS、Vercelの Next.js SaaS Starter、ixartz SaaS Boilerplate、Apptension SaaS Boilerplate、BoxyHQ SaaS Starter Kit、Makerkit Lite は MIT または Apache-2.0 で公開されています。違いは「無料版で何が省かれているか」です。

私はSeedの開発者なので、中立ではありません。他のプロジェクトについての記述には、2026年11月3日に確認したページへのリンクを付けました。他のキットのほうが合う場合は、そう書いています。

## 無料のSaaSボイラープレートにはどんなものがある？

| キット                             | ライセンス | 技術スタック                 | チームとロール                             | 決済                         | 動かす場所                                       |
| ---------------------------------- | ---------- | ---------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------------ |
| [Seed][seed]                       | MIT        | Deno、Hono、Preact、Postgres | グループ：閲覧者・編集者・管理者・オーナー | Stripe、メンバー単位         | 自分のLinuxサーバーでDocker Compose              |
| [Open SaaS][opensaas]              | MIT        | Wasp：React、Node.js、Prisma | 記載なし                                   | Stripe、Polar、Lemon Squeezy | Fly.io・Railwayにコマンド1つ、または任意のホスト |
| [Next.js SaaS Starter][next]       | MIT        | Next.js、Postgres、Drizzle   | Owner と Member                            | Stripe                       | Vercel（ガイドに記載）                           |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js、Drizzle、Clerk      | 組織とロール（Clerk経由）                  | 無料版にはなし               | 記載なし                                         |
| [Apptension SaaS Boilerplate][app] | MIT        | React、Django、Postgres      | テナント：Owner・Admin・Member             | Stripe                       | AWS（AWS CDK）                                   |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js、Prisma、Postgres    | チームとロール                             | Stripe、チーム単位のサブスク | Vercel・Heroku・DigitalOceanのボタン             |
| [Makerkit Lite][mk]                | MIT        | Next.js、Supabase            | Liteにはなし                               | Liteにはなし                 | Next.jsが動く任意のホスト                        |

「記載なし」は、プロジェクトのページに書かれていないという意味です。機能がないとは限りませんが、あてにはしないでください。

## 日本語対応はどこまで？

日本向けのSaaSなら、画面の翻訳は後回しにしにくい部分です。ここはキットによって大きく差があります。

- **Seed**：アプリ、管理画面、公開サイト、送信メールまで日本語を含む9言語が入っています。日付や数値の表示も言語ごとです。
- **Apptension**：8言語の翻訳ファイルがあります（英語、ポーランド語、ドイツ語、スペイン語、中国語、ヒンディー語、アラビア語、フランス語）。日本語はありません（[翻訳ファイルの一覧][app-locales]）。
- **ixartz**：next-intlによる多言語化の仕組みがあり、翻訳は英語とフランス語です（[翻訳ファイル][ix-locales]）。
- **Makerkit Lite** と **BoxyHQ**：仕組みはありますが、入っている翻訳は英語だけです。
- **Open SaaS** と **Next.js SaaS Starter**：多言語化はページで触れられていません。

つまり日本語訳まで入っているのは、2026年11月3日にリポジトリを見た限りSeedだけです。

Stripeは[日本で利用できる][stripe-global]ので（2026年11月3日確認）、Stripeを使うキットはどれも日本の法人でそのまま課金できます。

## 他のキットのほうが合うのはどんなとき？

- **Open SaaS**：個人向けに売り、Stripe以外にPolarやLemon Squeezyも選びたいとき。ただしWaspフレームワークを採用することになります。
- **Next.js SaaS Starter**：午後のうちに読み切れる、小さなNext.jsの土台がほしいとき。
- **ixartz**：Clerkでのログインに抵抗がなく、チームと多言語化を無料で使いたいとき。決済は有料版（Plus、Pro、Max）にあります。
- **Apptension**：チームがPythonとDjangoを書くとき。二要素認証、パスキー、SSO、3つのロール、Stripe、管理画面が揃います。
- **BoxyHQ**：初日からSAML SSOとSCIMを求める大企業に売るとき。チーム単位のStripeサブスクも入っています。

## Seedには何が入っている？

Seedは、チームがお金を払うプロダクトを、自分で管理するサーバーで動かすためのものです。今の `main` には、パスワード、パスキー、Google、GitHub、メールリンクでのログイン、認証アプリによる二要素認証、4つのロールと招待のあるグループ、無料プランと14日間の試用付きのメンバー単位のStripe課金、専用ドメインの管理画面、ファイルストレージ、アプリ内・Webプッシュ・ Telegramでの通知、オフラインで開けるアプリがあります。

正直な弱点：決済はStripeのみ。サーバーはDeno 2で動きます（NodeとBunへの対応は[予定][runtime]ですが日付は未定）。サーバーレスには向きません。メンテナーは私ひとりです。

## まず何をすればいい？

「お金を払うのは個人かチームか」「どの技術スタックを使いたいか」の2つを決めれば、表は1〜2行に絞れます。答えが「チーム、自分のサーバー」なら、日本語に切り替えられる[デモ](https://app.seedsaas.com)を触ってみて、[有料キットとの比較](/ja/compare)を読み、[リポジトリ][seed]から始めてください。

[seed]: https://github.com/spy4x/seed
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
[app-locales]: https://github.com/apptension/saas-boilerplate/tree/master/packages/webapp-libs/webapp-core/src/translations
[ix-locales]: https://github.com/ixartz/SaaS-Boilerplate/tree/main/src/locales
