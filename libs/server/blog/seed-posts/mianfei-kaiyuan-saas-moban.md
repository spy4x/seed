---
slug: mianfei-kaiyuan-saas-moban
language: zh-CN
translationOf: free-saas-boilerplate
title: 有没有免费开源的 SaaS 模板？7 个项目的真实对比
seoTitle: "免费开源 SaaS 模板：7 个 SaaS 脚手架对比"
description: 有。Seed、Open SaaS、Next.js SaaS Starter、ixartz、Apptension、BoxyHQ 和 Makerkit Lite 都免费开源。各自包含什么、中文支持如何、在国内收款要注意什么。
tldr:
  - 免费开源的 SaaS 模板（脚手架、boilerplate）有好几个，好的已经自带登录、支付和管理后台。
  - 付费模板的免费版，往往恰好去掉了支付或团队功能。
  - Stripe 不支持中国大陆公司注册，支持香港。七个模板都没有单独对接支付宝或微信支付，但香港公司的 Stripe 账户可以开通这两种支付方式。
  - Seed 自带带角色的群组、按成员计费的 Stripe 订阅、管理后台和包括简体中文在内的九种语言，部署在你自己的服务器上。
topic: 问答
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

有。免费开源的 SaaS 模板（也叫脚手架、boilerplate、starter kit）有好几个，好的已经自带登录、支付和管理后台。截至 2026 年 11 月 3 日，Seed、Open SaaS、Vercel 的 Next.js SaaS Starter、ixartz SaaS Boilerplate、Apptension SaaS Boilerplate、BoxyHQ SaaS Starter Kit 和 Makerkit Lite 都采用 MIT 或 Apache-2.0 许可证。真正的区别在于免费版省掉了什么。

Seed 是我开发的，所以我不是中立的一方。下面关于其他项目的每一条信息，都链接到我在 2026 年 11 月 3 日查看的原始页面；别的模板更适合你的情况，我也会直说。

## 有哪些免费的 SaaS 模板？

| 模板                               | 许可证     | 技术栈                       | 团队与角色                           | 支付                           | 部署方式                                     |
| ---------------------------------- | ---------- | ---------------------------- | ------------------------------------ | ------------------------------ | -------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno、Hono、Preact、Postgres | 群组：查看者、编辑者、管理员、所有者 | Stripe，按成员计费             | 任意自有 Linux 服务器上的 Docker Compose     |
| [Open SaaS][opensaas]              | MIT        | Wasp：React、Node.js、Prisma | 未提及                               | Stripe、Polar 或 Lemon Squeezy | 一条命令部署到 Fly.io 或 Railway，或任意主机 |
| [Next.js SaaS Starter][next]       | MIT        | Next.js、Postgres、Drizzle   | Owner 和 Member                      | Stripe                         | Vercel（见其部署指南）                       |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js、Drizzle、Clerk      | 组织与角色（通过 Clerk）             | 免费版没有                     | 未说明                                       |
| [Apptension SaaS Boilerplate][app] | MIT        | React、Django、Postgres      | 租户：Owner、Admin、Member           | Stripe                         | AWS（AWS CDK）                               |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js、Prisma、Postgres    | 团队与角色                           | Stripe，按团队订阅             | Vercel、Heroku、DigitalOcean 一键部署        |
| [Makerkit Lite][mk]                | MIT        | Next.js、Supabase            | Lite 版没有                          | Lite 版没有                    | 任意支持 Next.js 的主机                      |

“未提及”是指项目页面上没写。这不代表一定没有，但也别指望它有。

## 在国内做 SaaS，要先看哪几点？

英文评测很少提这些，但对国内开发者来说往往是第一道坎。

- **收款。** Stripe 的[可用国家和地区列表][stripe-global]里有香港，没有中国大陆（2026 年 11 月 3 日查看）。上表中的模板，支付都基于 Stripe、Polar 或 Lemon Squeezy，没有一个单独对接支付宝或微信支付。不过 Stripe 的[支付宝][alipay]和[微信支付][wechat]文档（2026 年 11 月 3 日查看）都把香港列为可开通的商户所在地，所以香港公司用 Stripe 时可以开通它们；订阅续费是否支持，以这两页文档为准。Seed 也只支持 Stripe：用香港公司可以直接用；否则要自己把计费模块（[docs/billing.md][billing]）换成国内支付渠道，这是几天的工作量。
- **登录方式。** 如果你的用户在国内，Google 和 GitHub 登录未必好用。Seed 除了这两种，还支持密码（带邮箱验证码）、通行密钥（passkey）和邮箱登录链接，这些不依赖境外服务。ixartz 的登录则托管在 Clerk 这个第三方服务上。
- **部署位置。** Seed 用 Docker Compose 跑在任意一台 Linux 服务器上，阿里云、腾讯云的云服务器都可以；在大陆服务器上对外提供网站服务，照常需要办理 ICP 备案。依赖 Vercel、AWS 或 Supabase 的模板，要先确认这些服务在你的用户那里访问是否稳定。
- **中文界面。** 七个模板里有简体中文翻译的只有两个：Seed，以及 Apptension（它的[翻译文件][app-locales]里有 `zh.json`）。ixartz 只有英文和法文，Makerkit Lite 和 BoxyHQ 只有英文。

## 什么时候选别的模板更好？

- **Open SaaS**：面向个人用户销售，并且想在 Stripe 之外选 Polar 或 Lemon Squeezy。代价是要接受 Wasp 框架。
- **Next.js SaaS Starter**：想要一个一下午就能读完的小型 Next.js 底座，其余自己写。
- **Apptension**：团队写 Python 和 Django。它有双因素登录、通行密钥、SSO、三种角色、Stripe、管理后台，还有中文翻译。
- **BoxyHQ**：客户是大企业，第一天就要求 SAML 单点登录和 SCIM 目录同步。它也带有按团队计费的 Stripe 订阅。

## Seed 包含什么？

Seed 面向“按团队付费”的产品，部署在你自己掌控的服务器上。目前 `main` 分支已有：密码、通行密钥、Google、GitHub 和邮箱链接登录，身份验证器 App 的双因素认证，带四种角色和邀请功能的群组，按成员计费的 Stripe 订阅（含免费套餐和 14 天试用），独立域名上的管理后台，文件存储，应用内、Web 推送和 Telegram 通知，可离线打开的应用，以及包括简体中文在内的九种语言。

坦白说它的短板：只支持 Stripe；服务端运行在 Deno 2 上（支持 Node 和 Bun 已在[计划中][runtime]，暂无日期）；不适合 Serverless；目前只有一位维护者，就是我。

## 从哪里开始？

先回答两个问题：谁付钱，个人还是团队？你能用哪种方式收款？表格立刻就能缩到一两行。如果答案是“团队，用自己的服务器”，可以先试试能切换到中文的[在线演示](https://app.seedsaas.com)，看看[与付费模板的对比](/zh-CN/compare)，然后从[代码仓库][seed]开始。

[seed]: https://github.com/spy4x/seed
[billing]: https://github.com/spy4x/seed/blob/main/docs/billing.md
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
[alipay]: https://docs.stripe.com/payments/alipay
[wechat]: https://docs.stripe.com/payments/wechat-pay
[app-locales]: https://github.com/apptension/saas-boilerplate/tree/master/packages/webapp-libs/webapp-core/src/translations
