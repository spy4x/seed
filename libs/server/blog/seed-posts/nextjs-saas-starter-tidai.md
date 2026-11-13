---
slug: nextjs-saas-starter-tidai
language: zh-CN
translationOf: nextjs-saas-starter-alternatives
title: "Next.js SaaS Starter 替代方案：不够用时选什么"
seoTitle: "Next.js SaaS Starter 替代方案：免费与付费模板对比"
description: Next.js SaaS Starter 免费，而且刻意做得很小：没有密码重置，也不发邀请邮件。这里对比把这些功能都做好了的免费和付费替代方案，并注明来源。
tldr:
  - Next.js SaaS Starter 免费、采用 MIT 许可证，带所有者和成员两种角色的团队功能和 Stripe Checkout。
  - 它不发送任何邮件，邀请、密码重置和邮箱验证都要你自己做。
  - 免费且这些都现成的是 Seed；想留在 Next.js 又要更多现成功能，就选 Makerkit 或 Supastarter。
  - 如果你想要一份小代码来学习，或想按自己的方式写登录，就继续用这个模板。
topic: 问答
intro: "Next.js SaaS Starter 是一个干净的小底座，它的 README 自己就说它是用来学习的。下面说说它缺什么，以及需要这些功能现成可用时该选哪个模板。"
relatedFeature: sign-in
coverAlt: "一株幼苗外围着一个小木框，后面是一座建好的、种满紫色植物的玻璃温室。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Next.js SaaS Starter 是一个采用 MIT 许可证的免费模板：邮箱和密码登录、Stripe Checkout，以及带所有者和成员两种角色的团队。它的 README 说它刻意保持最小，是一份学习资源。当你想要更多现成功能时，替代方案有两个方向：Seed 免费、MIT，带邀请、密码重置、通行密钥和按成员计费；Makerkit 和 Supastarter 是让你继续用 Next.js 的付费套件。

我是 Seed 的开发者，请带着这一点阅读。关于其他产品的每条信息都链接了来源，我在 2026 年 11 月 4 日核对过。发现过时的内容？[提个 issue](https://github.com/spy4x/seed/issues)，我会修正。

## Next.js SaaS Starter 里有什么？

[Next.js SaaS Starter](https://github.com/nextjs/saas-starter) 位于 GitHub 上的 Next.js 组织，大部分提交来自 Lee Robinson。它有约 16,250 颗星。README 列出：

- 一个落地页和一个打开 Stripe Checkout 的价格页；
- 邮箱和密码登录，JWT 存在 Cookie 里；
- 带团队和所有者、成员角色的仪表盘；
- 在 Stripe 的 Customer Portal 里管理订阅；
- 用户操作的活动日志。

技术栈是 Next.js、使用 Drizzle 的 Postgres 和 shadcn/ui。一个下午就能读完全部代码，这正是它的用意。

## 它缺什么？

它不发邮件。`package.json` 里没有邮件库，邀请成员只会把邀请存进数据库而不会发出去；代码里也写着：[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454)。代码里也没有密码重置和邮箱验证。

登录只有邮箱和密码：没有 Google、GitHub、通行密钥，也没有第二因素。

计费是每个团队一个订阅。Checkout 以数量 1 和 14 天试用开始，只有有人在 Customer Portal 里修改时数量才会变（[stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)）。添加成员不会改变账单。

它的更新也很慢。最近两次提交在 2025 年 12 月 8 日和 11 日，都是 Next.js 的安全更新，第二次为修复 CVE-2025-55182 把 Next.js 升到 `15.6.0-canary.59`；再往前一次是 2025 年 6 月。

对它自己声称的定位来说，这些都不算缺陷。只是意味着，付费团队最先需要的那部分要由你来写。

## 替代方案对比

| 功能       | Next.js SaaS Starter | Seed                            | Open SaaS                    | Makerkit                      | Supastarter                     |
| ---------- | -------------------- | ------------------------------- | ---------------------------- | ----------------------------- | ------------------------------- |
| 价格       | 免费                 | 免费                            | 免费                         | 一次性 299 或 599 美元        | 一次性 349 到 1,499 美元        |
| 许可证     | MIT                  | MIT                             | MIT                          | 付费；Lite 套件为 MIT         | 付费                            |
| 技术栈     | Next.js、Drizzle     | Hono、Preact；Postgres          | Wasp（React、Node.js）       | Next.js 16、TanStack Start 等 | Next.js、Nuxt 或 TanStack Start |
| 团队和角色 | 所有者和成员         | 从查看者到所有者                | 无                           | 有，带邀请                    | 有，带邀请                      |
| 邀请邮件   | 不发送               | 有                              | 没有团队                     | 未核实                        | 未核实                          |
| 计费       | Stripe，每团队一个   | Stripe，按成员                  | Stripe、Polar、Lemon Squeezy | 未核实                        | Stripe、Lemon Squeezy 等五家    |
| 托管       | Vercel               | 在你的服务器上用 Docker Compose | Fly.io 或 Railway            | 未核实                        | Vercel、Serverless 或 Docker    |

来源：[Next.js SaaS Starter](https://github.com/nextjs/saas-starter)、[Open SaaS](https://github.com/wasp-lang/open-saas)、[Makerkit 价格](https://makerkit.dev/pricing)、[Supastarter](https://supastarter.dev/) 和 [Seed 的 README](https://github.com/spy4x/seed)。Makerkit 的价格是折扣价，原价为 349 和 649 美元。“未核实”表示我在读过的页面上没找到，而不是它没有这项功能。

## 我该选哪个替代方案？

**你想留在 Next.js，并且要更多现成功能。** 买 Makerkit 或 Supastarter。两者都有带邀请和角色的组织功能；Supastarter 按席位计费，支持五家支付服务商。Makerkit Lite 免费、MIT，但没有团队和计费。

**你想要免费的，而且团队功能已经做好。** 那就是 Seed。每个账号都有一个群组，角色从查看者到所有者；邀请通过邮件发出；Stripe 按成员计费，数量随成员人数变化，有免费套餐、14 天试用和付款失败后的宽限期。登录也是现成的：带确认码的密码、通行密钥、Google、GitHub、邮件登录码、访客账号，以及认证器应用作为第二因素（[Seed 的登录功能](/zh-CN/features/sign-in)）。此外还有带审计日志的管理应用、实时更新、离线应用和九种语言。代价是：它不是 Next.js，而是 Hono 和 Preact。

**你卖给个人，喜欢让框架处理胶水代码。** 看看 Open SaaS；我也写过[它的替代方案](/zh-CN/blog/open-saas-tidai)。

## 托管要花多少钱：Vercel 还是一台服务器？

这个模板的 README 部署到 Vercel，Postgres 可以用任何连接地址。Seed 跑在一台你租的服务器上。下面把两者放在一起，用 Vercel Pro 加 Supabase Pro 作为常见的托管组合；选一台服务器，再按你的团队调整滑块：

<HostingCost server="cx23" developers={1} />

一个开发者时，Seed 在 Hetzner CX23 上每月 12.48 欧元，托管组合是 45 美元，按欧洲央行 2026 年 11 月 2 日的汇率约 40.12 欧元。这不是完全对等的比较：托管组合不需要你给服务器打补丁，数据库备份也有人替你做。包含每个价格及其来源的完整计算见[把 SaaS 部署到一台 Hetzner 服务器](/blog/deploy-saas-to-one-hetzner-server)（英文）。

## 什么时候 Next.js SaaS Starter 仍是更好的选择？

- 你想通过一份能完整读完的代码学习 App Router 和 Server Actions。
- 你会按自己的方式写登录和计费，希望要删的东西越少越好。
- 你的团队熟悉 Next.js 和 React，并且部署到 Vercel。

Seed 的风险，供你权衡：它很年轻，只有一位维护者。它的 API 和 worker 在 env 文件里改一行就能跑在 Node 或 Bun 上（[关于运行时](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)），但网站和工具链仍然需要 Deno。

## 决定之前怎么试用 Seed？

打开[在线演示](https://app.seedsaas.com)：点一下就会登录一个带示例数据的访客账号。邀请一位同事，再打开计费页面，这正是 Next.js 模板留给你自己做的部分。如果合适，就克隆[仓库](https://github.com/spy4x/seed)。想看更全面的对比，[ShipFast 替代方案](/zh-CN/blog/shipfast-tidai)把七个模板放进了一张表。
