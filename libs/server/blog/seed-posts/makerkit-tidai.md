---
slug: makerkit-tidai
language: zh-CN
translationOf: makerkit-alternatives
title: "Makerkit 替代方案：免费的 SaaS 模板，以及什么时候值得付钱"
seoTitle: "Makerkit 替代方案：免费开源的 SaaS 模板"
description: Makerkit 299 美元起，免费的 Lite 版没有计费也没有团队。这里是两样都有的免费替代品，每条信息都注明来源，并说明什么时候 Makerkit 值这个价。
tldr:
  - Makerkit 的付费套件一次性 299 或 599 美元；免费的 Lite 版没有计费、团队和管理后台。
  - 用付费套件做的项目不能开源，自由职业者每个客户都要单独买许可证。
  - Seed 免费且采用 MIT 许可证，带团队、按成员计费和管理应用，跑在你自己的服务器上。
  - 想要 Supabase、Next.js、React Router 和面向编程智能体的工具，就选 Makerkit。
topic: 问答
intro: "Makerkit 是做工精良的付费套件，还有一个免费的 Lite 版，而两者之间的差距，正是面向团队的产品所需要的东西。下面是能补上这个差距的免费替代品，每个事实都附有来源，也说明什么情况下付钱买 Makerkit 才是对的。"
relatedFeature: deploy
coverAlt: "一个敞开的紫色大工具箱，托盘里装满工具；旁边是一个上了挂锁、合着的灰色小工具箱。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

能保留 Makerkit 付费套件所增加的东西（团队、计费和管理后台）的免费替代品是 Seed：一个采用 MIT 许可证的模板，带群组和角色、Stripe 按成员计费，以及独立域名上的管理应用。Makerkit 自己的免费套件 Lite 恰好把这三样都去掉了。想要更小的免费底子，有 Next.js SaaS Starter；付费的还有 Supastarter。Makerkit 的付费套件一次性 299 或 599 美元。

Seed 是我做的，读的时候请记住这一点。关于其他产品的每条信息都链接到来源，每个页面我都在 2026 年 11 月 4 日读过。有变化？[提一个 issue](https://github.com/spy4x/seed/issues)，我来改。

## Makerkit 提供什么，Lite 又缺什么？

[Makerkit](https://makerkit.dev/) 在三种数据层（Supabase；Drizzle 加 Better Auth；Prisma 加 Better Auth）上提供套件，面向 Next.js 16、TanStack Start，Supabase 版还支持 React Router 8。首页列出：密码、魔法链接、可选通行密钥、OAuth 和身份验证器应用登录；带角色和邀请的团队账户；固定、按席位或按用量的 Stripe 订阅；可以以用户身份登录或封禁用户的超级管理员；多语言；博客和文档；Supabase 套件里的实时通知。面向编程智能体，它还提供规则、技能和一个 MCP 服务器。

[价格页](https://makerkit.dev/pricing)列出两种一次性许可证，均含终身更新：

- **Pro**，349 美元，套件卡片上标 299 美元：1 名开发者，项目不限数量。
- **Teams**，649 美元，卡片上标 599 美元：仓库最多 5 人。

购买前请读条款，有两条出人意料。自由职业者每个客户都要单独买一份许可证。用付费套件做的项目不能作为开源发布，这种用途页面会让你去用 Lite。获得访问权限后一般不退款，所以价格页自己也建议先试 Lite。

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) 免费、MIT，GitHub 约 470 星：Next.js、Supabase 登录、个人资料页、多语言和营销页。README 列出了它去掉的东西，而这张清单正是团队产品的核心：计费、团队账户、邮件模板、超级管理后台、博客和文档。

## 一张表看懂 Makerkit 和替代方案

| 模板                                                                      | 价格                                    | 许可证                     | 技术栈                                  | 团队与计费                       | 托管                                 |
| ------------------------------------------------------------------------- | --------------------------------------- | -------------------------- | --------------------------------------- | -------------------------------- | ------------------------------------ |
| [Makerkit](https://makerkit.dev/pricing)                                  | 一次性 299 或 599 美元（标价 349、649） | 付费，不可开源，按客户授权 | Next.js、React Router 或 TanStack Start | 有，按席位                       | 推荐 Vercel；Cloudflare、Docker、VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | 免费                                    | MIT                        | Next.js、Supabase                       | 无                               | 未提及                               |
| [Seed](https://github.com/spy4x/seed)                                     | 免费                                    | MIT                        | Hono、Preact；Postgres                  | 有，按成员                       | 你自己的服务器，Docker Compose       |
| [Supastarter](https://supastarter.dev/)                                   | 一次性 349、799 或 1499 美元            | 付费，禁止再分发           | Next.js、Nuxt 或 TanStack Start         | 有，按席位                       | Vercel、Docker、Coolify 等           |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | 免费                                    | MIT                        | Next.js、Drizzle；Postgres              | Owner 和 Member；Stripe Checkout | Vercel                               |

Makerkit 的托管一栏来自它的[上线检查清单](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist)：推荐 Vercel，并提醒 Docker 或 VPS“需要更多配置”。[对比页](/zh-CN/compare)列出了六个模板的 19 项功能。

## 在中国开发，收款怎么办？

根据 [Stripe 的国家列表](https://stripe.com/global)（2026 年 11 月 4 日核对），Stripe 不支持中国大陆的公司，但支持香港公司。Seed 只通过 Stripe 收款。Makerkit 首页在 Stripe 之外还提到了 Polar，它自称 [merchant of record](https://polar.sh/)（记录商家）；它是否接受你所在的地区，请向 Polar 确认。Seed 已经翻译成包括简体中文在内的九种语言。

## 哪个免费替代品补上了 Makerkit Lite 缺的东西？

**Seed** 三样都有。每个人注册时都会得到一个群组，角色有查看者、编辑、管理员和所有者。Stripe 按成员计费，带免费方案、14 天试用和付款失败后的宽限期。独立域名上的管理应用可以查找用户、退款，并把每个操作记进审计日志。登录支持密码、通行密钥、邮件验证码、Google 和 GitHub，第二因素用身份验证器应用。它还有 Makerkit 任何页面都没提到的东西：断网也能打开并把修改排队的应用，以及写在 Compose 文件里的服务器监控（VictoriaMetrics、Grafana）和备份。

因为 Seed 是 MIT，许可证的那两个意外都不存在：把你的产品开源发布，或者在上面做十个客户项目，谁都不需要第二份许可证。我自己就在 Seed 上给客户做 MVP，所以这不是纸上谈兵。

**Next.js SaaS Starter**（约 16,300 星）介于 Lite 和付费套件之间：Owner 和 Member 两种角色的团队，基于 Next.js、Drizzle 和 Postgres 的 Stripe Checkout 与 Customer Portal，没有管理后台。

## 托管还要另花多少？

Makerkit 的检查清单推荐 Vercel，主力套件跑在 Supabase 上。这对组合按月收费，按开发者席位、按数据库计。Seed 跑在你租的一台服务器上。选一台服务器和团队人数：

<HostingCost server="cx23" developers={1} />

一名开发者时，Seed 在 CX23 上每月 12.48 欧元，Vercel Pro 加 Supabase Pro 是 45 美元。这不是完全对等的比较：托管组合会替你更新、扩容和备份。怎么把 Seed 放到服务器上：见[部署指南](/zh-CN/docs/deploy)。

## 什么时候值得为 Makerkit 付钱？

- **你想用 Supabase。** Makerkit 的主力套件依赖它的认证、存储和 row-level security。Seed 有自己的 Postgres 和登录。
- **你想用 Next.js 或 React Router。** Seed 全部用 Preact，公开网站也是。
- **你需要以用户身份登录、按用量计费或第二家支付服务商。** Makerkit 列出了前两项，首页还在 Stripe 旁边提到 Polar。Seed 三样都没有，Stripe 是它唯一的服务商。
- **你和编程智能体一起工作。** Makerkit 有 MCP 服务器和技能。Seed 有[给智能体的说明](/zh-CN/docs/ai-agents)，但没有 MCP 服务器（[#211](https://github.com/spy4x/seed/issues/211)）。
- **你想要有长期记录的维护者。** Makerkit 说它从 2022 年起就全职维护。Seed 很年轻，只有一位维护者：我。

## 做决定前，怎么先试试 Seed？

打开[在线演示](https://app.seedsaas.com)：点一下就打开一个带示例数据的访客账户，两分钟内就能建团队、邀请成员、打开计费页面。然后 clone [仓库](https://github.com/spy4x/seed)。如果 Makerkit 更合适，就照它价格页的建议，从 Lite 开始。更多选择：[Supastarter 替代方案](/zh-CN/blog/supastarter-tidai)。
