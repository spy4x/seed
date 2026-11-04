---
slug: open-saas-tidai
language: zh-CN
translationOf: open-saas-alternatives
title: "Open SaaS 替代方案：Wasp 免费模板不合适时选什么"
seoTitle: "Open SaaS（Wasp）替代方案：免费与付费 SaaS 模板对比"
description: Open SaaS 免费、采用 MIT 许可证、基于 Wasp，但没有团队功能。如果你要卖给团队、想写普通 TypeScript 或在自己的服务器上运行，这里对比它的替代方案，并注明来源。
tldr:
  - Open SaaS 免费、采用 MIT 许可证，自带支付、管理后台和文件上传，基于 Wasp 构建。
  - 它没有团队或组织功能，每个订阅只属于一个用户。
  - 如果付费的是团队，看看 Seed（免费、MIT）或付费的 Makerkit 和 Supastarter。
  - 如果付费的是个人、想一条命令部署，或需要 Polar 和 Paddle，继续用 Open SaaS 就好。
topic: 问答
intro: "Open SaaS 是最好的免费 SaaS 模板之一，这点我是认真的。但它替你做了两个决定：一人一个订阅，以及 Wasp 框架。下面说说当其中一个不适合你时该选什么。"
relatedFeature: groups
coverAlt: "一座敞开门的玻璃温室，里面有一个种满紫色植物的大型共用花槽，门边摆着一排五个小花盆。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

Open SaaS 是功能最全的免费 SaaS 模板之一：MIT 许可证，GitHub 上约 16,250 颗星，自带支付、管理后台和文件上传。三种情况下你需要替代方案：你要卖给团队（Open SaaS 没有组织功能），你不想基于 Wasp 框架开发，或者你想在自己的服务器上运行。这时可以看看 Seed（免费、MIT，带团队和按成员计费），或付费的 Makerkit 和 Supastarter。

我是 Seed 的开发者，所以并不中立。关于其他产品的每条信息都链接了来源，我在 2026 年 11 月 4 日逐一核对过。发现过时的内容？[提个 issue](https://github.com/spy4x/seed/issues)，我会修正。

## Open SaaS 提供了什么？

[Open SaaS](https://github.com/wasp-lang/open-saas) 是 Wasp 框架团队做的免费模板。它的 README 列出的功能，对一个免费模板来说相当多：

- 带邮箱验证的邮箱注册，另有 Google、GitHub 和 Discord，可在[登录配置](https://github.com/wasp-lang/open-saas/blob/main/template/app/src/auth/auth.wasp.ts)中开启；
- 通过 Stripe、Polar 或 Lemon Squeezy 收款，代码里还有 Paddle 的集成；
- 基于 shadcn/ui 的管理后台、上传到 AWS S3 的文件、通过 SendGrid、Mailgun 或 SMTP 发送的邮件；
- Plausible 或 Google Analytics、一个 OpenAI 演示应用、基于 Astro 的文档站和博客，以及 Playwright 端到端测试；
- 面向 AI 编程助手的规则、技能和 Claude Code 插件。

而且项目很活跃：最近一次提交是 2026 年 10 月 28 日。

它缺的是团队功能。[数据库结构](https://github.com/wasp-lang/open-saas/blob/main/template/app/schema.prisma)里只有一个带 `isAdmin` 标记的 `User`，没有团队或组织模型，所以订阅属于某一个人。对每人自己买的工具来说，这正合适。对 B2B 产品来说，团队、邀请、角色和按席位计费就是你头几周的工作。

## 基于 Wasp 开发意味着什么？

Wasp 是一个全栈框架：你在一个文件 `main.wasp.ts` 里描述页面、路由、登录、任务和服务器操作，Wasp 据此生成 React、Node.js 和 Prisma 应用（[Wasp 文档](https://wasp.sh/docs)）。它能省掉大量胶水代码，这正是它存在的意义。

代价是：你的应用要遵循框架的形态。你要学它的规范，跟着它升级，而且 Wasp 还没到 1.0：最新版本是 [2026 年 10 月 23 日发布的 0.26.1](https://github.com/wasp-lang/wasp/releases)。很多团队用得很满意。只是请有意识地做这个选择，而不是顺手就选了。

部署很简单：`wasp deploy` 一条命令就能把数据库、服务器和客户端部署到 Fly.io 或 Railway，手动方式可以部署到任何主机（[部署指南](https://docs.opensaas.sh/guides/deploying/)）。指南里没有提到 Docker。

## 替代方案对比

| 功能       | Open SaaS                        | Seed                            | Makerkit                      | Supastarter                     |
| ---------- | -------------------------------- | ------------------------------- | ----------------------------- | ------------------------------- |
| 价格       | 免费                             | 免费                            | 一次性 299 或 599 美元        | 一次性 349 到 1,499 美元        |
| 许可证     | MIT                              | MIT                             | 付费；Lite 套件为 MIT         | 付费                            |
| 技术栈     | Wasp（React、Node.js、Prisma）   | Hono、Preact；Postgres          | Next.js 16、TanStack Start 等 | Next.js、Nuxt 或 TanStack Start |
| 团队和角色 | 无                               | 有，从查看者到所有者            | 有，带邀请和权限              | 有，带邀请和角色                |
| 支付       | Stripe、Polar、Lemon Squeezy     | Stripe，按成员计费              | 未核实                        | Stripe、Lemon Squeezy 等五家    |
| 管理后台   | 管理仪表盘                       | 独立主机上的管理应用，审计日志  | Lite 套件中没有               | 未核实                          |
| 托管       | 一条命令部署到 Fly.io 或 Railway | 在你的服务器上用 Docker Compose | 未核实                        | Vercel、Serverless 或 Docker    |

来源：[Open SaaS README](https://github.com/wasp-lang/open-saas)、[Makerkit 价格](https://makerkit.dev/pricing)、[Supastarter](https://supastarter.dev/) 和 [Seed 的 README](https://github.com/spy4x/seed)。Makerkit 的价格是折扣价，原价为 349 和 649 美元。“未核实”表示我在读过的页面上没找到，而不是它没有这项功能。

## 面向团队的产品适合哪个替代方案？

我做 Seed 正是为了这个。每个人注册时都会得到一个群组，群组有从查看者到所有者的角色和邮件邀请，Stripe 按成员计费：数量随成员人数变化，有免费套餐、14 天试用和付款失败后的宽限期（[计费文档](https://github.com/spy4x/seed/blob/main/docs/billing.md)）。具体效果见[群组页面](/zh-CN/features/groups)。

其他基础也都有了：

- 密码、通行密钥、Google、GitHub 或邮件验证码登录，访客账号，以及认证器应用作为第二因素；
- 运行在独立主机上的管理应用，每个操作都写入审计日志；
- 通过 WebSocket 实时更新，应用离线也能打开并保存修改；
- 文件存储、包括从右到左的阿拉伯语在内的九种语言，以及写在 Compose 文件里的备份和监控。

它是基于 Hono 和 Preact 的普通 TypeScript，你和代码之间没有规范文件或代码生成器。它用 Docker Compose 跑在一台租来的服务器上，所以账单是每月固定的金额。

付费套件里，**Makerkit** 和 **Supastarter** 都有带邀请和角色的组织功能，Supastarter 支持按席位计费。免费的 Makerkit Lite 既没有团队，也没有计费。

## 什么时候 Open SaaS 是更好的选择？

- 你卖给个人，想今天就免费用上支付、管理后台和文件上传。
- 你喜欢 Wasp 的方式：一个规范文件，少写很多胶水代码。
- 你想用 Polar、Lemon Squeezy 或 Paddle。Seed 只支持 Stripe；记录商户（Merchant of Record）类支付服务是一个待讨论的想法（[#584](https://github.com/spy4x/seed/issues/584)），不是计划。
- 你想一条命令部署到 Fly.io 或 Railway，不用自己维护服务器。
- 你想要一个大社区：Wasp 有 [Discord](https://discord.gg/rzdnErX)，Open SaaS 在 GitHub 上的星数远多于 Seed。

Seed 的风险也说清楚，方便你权衡：它是一个年轻的项目，只有一位维护者。它的 API 和 worker 在 env 文件里改一行就能跑在 Node 或 Bun 上（[关于运行时](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)），但网站和工具链仍然需要 Deno。Android 和桌面应用[还没有做](https://github.com/spy4x/seed/issues/202)。

## 怎样用一个下午比较它们？

1. 按 README 的说明，用 `wasp new -t saas` 创建一个 Open SaaS 应用。
2. 打开 Seed 的[在线演示](https://app.seedsaas.com)：点一下就会登录一个带示例数据的访客账号。
3. 在两边都试试你的客户第一天会做的事。如果客户以团队形式到来，就邀请一位同事，再打开计费页面。

我的其他对比：[ShipFast 替代方案](/zh-CN/blog/shipfast-tidai)把七个模板放进一张表，[免费开源 SaaS 模板指南](/zh-CN/blog/mianfei-kaiyuan-saas-moban)讲免费模板一开始就该带些什么。如果 Seed 合适，[仓库](https://github.com/spy4x/seed)克隆下来就能用。
