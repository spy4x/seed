---
slug: supastarter-tidai
language: zh-CN
translationOf: supastarter-alternatives
title: "Supastarter 替代方案：面向团队的免费和付费 SaaS 模板"
seoTitle: "Supastarter 替代方案：面向团队的 SaaS 模板对比"
description: Supastarter 一次性收费 349 到 1499 美元。对比带组织和按席位计费的免费与付费替代品，每条信息都注明来源，并说明 Supastarter 在哪些情况下仍然更好。
tldr:
  - Supastarter 是面向 Next.js、Nuxt 或 TanStack Start 的付费套件，一次性 349、799 或 1499 美元。
  - Seed 是采用 MIT 许可证的免费替代品，自带群组、角色和 Stripe 按成员计费。
  - 最接近的付费对手是 Makerkit，最精简的免费选择是 Next.js SaaS Starter。
  - Stripe 不支持中国大陆公司，但支持香港公司；需要别的收款渠道时，Supastarter 提供的更多。
topic: 问答
intro: "Supastarter 是功能最全的付费 SaaS 套件之一，带组织、按席位计费和五家支付服务商，价格是 349 到 1499 美元。我把它和同样支持团队的免费、付费替代品做了对比，每个事实都附有来源。"
relatedFeature: groups
coverAlt: "一艘紫色的长划艇，桨很多、座位空着，系在码头上；旁边停着一艘挂着空白价签的灰色游艇。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-04T09:00:00Z
newsletter: false
---

对于卖给团队的产品，Supastarter 的主要替代方案有两个：Seed，一个采用 MIT 许可证的免费模板，自带群组、角色和 Stripe 按成员计费；以及 Makerkit，一个 299 美元起的付费套件。想要更小的免费底子，还有 Next.js SaaS Starter 和 Open SaaS，不过团队或计费要你自己做。Supastarter 一次性收费 349、799 或 1499 美元，支持的支付服务商比它们都多。

Seed 是我做的，所以我并不中立。因此，关于其他产品的每条信息都链接到来源，每个页面我都在 2026 年 11 月 4 日读过，文中还有一节专门讲 Supastarter 更合适的情况。发现信息过时？[提一个 issue](https://github.com/spy4x/seed/issues)，我来改。

## Supastarter 包含什么？

[Supastarter](https://supastarter.dev/) 是面向 Next.js、Nuxt 或 TanStack Start 的付费模板。首页列出三档一次性价格，均含终身更新：

- **Solo**，349 美元：1 名开发者，个人项目不限数量，可商用。
- **Startup**，799 美元：最多 5 名开发者，团队项目，一次 60 分钟的咨询，优先邮件支持。
- **Agency**，1499 美元：最多 10 名开发者，客户项目，白标，以及和创始人的私有 Discord 频道。

里面有：基于 Better Auth 的登录（密码、通行密钥、魔法链接、OAuth 和双重验证）；带邀请、角色和按席位计费的组织；Stripe、Lemon Squeezy、Polar、Creem 和 Dodo Payments；可以以用户身份登录的超级管理员；多语言；MDX 博客和文档；用 trigger.dev 或 QStash 跑的后台任务；S3 存储；Sentry；以及一个 AI 聊天机器人示例。默认用 Prisma 或 Drizzle 跑在 PostgreSQL 上，[文档](https://supastarter.dev/docs/nextjs)里有部署到 Vercel、Render、Fly.io、Netlify、Docker、Coolify 和 Railway 的指南。

[许可证](https://supastarter.dev/legal/license)允许你为自己或客户做任意多个产品并出售。不能再分发代码，不能共享许可证，公开仓库需要作者许可。我读过的页面里没有找到退款政策，购买前请先问清楚。

## 一张表看懂 Supastarter 和替代方案

| 模板                                                           | 价格                             | 许可证              | 技术栈                                    | 团队与角色      | 托管                                 |
| -------------------------------------------------------------- | -------------------------------- | ------------------- | ----------------------------------------- | --------------- | ------------------------------------ |
| [Supastarter](https://supastarter.dev/)                        | 349、799 或 1499 美元            | 付费，禁止再分发    | Next.js、Nuxt 或 TanStack Start；Postgres | 有，按席位计费  | Vercel、Docker、Coolify 等           |
| [Seed](https://github.com/spy4x/seed)                          | 免费                             | MIT                 | Hono、Preact；Postgres                    | 有，按成员      | 你自己的服务器，Docker Compose       |
| [Makerkit](https://makerkit.dev/pricing)                       | 299 或 599 美元（标价 349、649） | 付费；Lite 版为 MIT | Next.js、React Router 或 TanStack Start   | 有，按席位      | 推荐 Vercel；Cloudflare、Docker、VPS |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) | 免费                             | MIT                 | Next.js、Drizzle；Postgres                | Owner 和 Member | Vercel                               |
| [Open SaaS](https://github.com/wasp-lang/open-saas)            | 免费                             | MIT                 | Wasp（React、Node.js、Prisma）；Postgres  | 未提及          | Railway 或 Fly.io，或任何主机        |

“未提及”指产品页面没有写，不代表加不上。Makerkit 的价格页把 349 和 649 美元划掉，实际收 299 和 599 美元；它的常见问题里仍写着 349 和 649 美元。[对比页](/zh-CN/compare)把六个模板的 19 项功能放在一张表里。

## 在中国开发，收款怎么办？

先看这一点，再看技术栈。根据 [Stripe 的国家列表](https://stripe.com/global)（2026 年 11 月 4 日核对），Stripe 不支持中国大陆的公司，但支持香港公司。Seed 只通过 Stripe 收款。Supastarter 有五家服务商，其中 [Lemon Squeezy](https://www.lemonsqueezy.com/) 和 [Polar](https://polar.sh/) 自称 merchant of record（记录商家）：以它们的名义替你销售并处理税务。它们是否接受你所在的地区，请逐一确认；我没有核实。对 Seed 来说，记录商家类的服务商只是一个开放的想法（[#584](https://github.com/spy4x/seed/issues/584)），不是计划。

Seed 已经翻译成包括简体中文在内的九种语言，应用、管理后台、网站和邮件都有。

## 有没有带团队和计费的免费 Supastarter 替代品？

有，而这恰恰是多数免费模板留下的空白。它们止步于登录和 Stripe Checkout；团队、角色和按成员定价，正是你本来要为 Supastarter 付钱的那部分。

**Seed** 做了这部分。每个人注册时都会得到一个群组，角色有查看者、编辑、管理员和所有者；Stripe 按成员计费，带免费方案、14 天试用和付款失败后的宽限期。登录支持密码、通行密钥、邮件验证码、Google 和 GitHub，第二因素用身份验证器应用。独立域名上的管理应用可以查找用户、退款，并把每个操作记进审计日志。除了 Supastarter 列出的功能，Seed 还有基于 WebSocket 的实时更新、断网也能打开并把修改排队的应用，以及写在 Compose 文件里的服务器监控（VictoriaMetrics、Grafana）和备份。

**Next.js SaaS Starter**（GitHub 约 16,300 星）小而实在：邮箱加密码、Stripe Checkout、Owner 和 Member 两种角色的团队。一个晚上就能读完，剩下的自己搭。

**Open SaaS**（同样约 16,300 星）有管理后台、上传到 S3、后台任务，以及 Stripe、Polar 或 Lemon Squeezy，但 README 没有提到团队。

## 托管还要再花多少？

许可证只付一次，托管账单却每月都来。Supastarter 的部署指南从 Vercel 开始，Supabase 这样的托管 Postgres 也是它的数据库指南之一。Seed 跑在你租的一台服务器上。拖动滑块，比较 Vercel Pro 加 Supabase Pro 和跑在 Hetzner 服务器上的 Seed：

<HostingCost server="cx23" developers={1} />

一名开发者时，Seed 在 CX23 上每月 12.48 欧元，托管组合是 45 美元。怎么把 Seed 放到服务器上：见[部署指南](/zh-CN/docs/deploy)。Supastarter 也能用 Docker 跑在你自己的服务器上，所以上面的差价是托管方案的价格，不是 Supastarter 的价格。

## 什么时候还是选 Supastarter 更好？

- **你写 Vue。** Supastarter 有 Nuxt 版。Seed 用 Preact，Makerkit 用 React。
- **你现在就需要 Stripe 以外的收款渠道。** Supastarter 有五家，Seed 只有 Stripe。
- **你想要按用量计费、以用户身份登录或 AI 聊天机器人示例。** Supastarter 三样都列了，Seed 一样都没有。
- **你部署在 Vercel 或无服务器平台上。** Seed 需要一台你能掌控的服务器。
- **你想要付费咨询和一个会回复你的卖家。** Startup 和 Agency 都含咨询。Seed 只有 GitHub issue 和我。

也请掂量 Seed 的风险：这是个年轻的项目，只有一位维护者。它的 API 和 worker 可以跑在 Deno、Node 或 Bun 上（[文档](https://github.com/spy4x/seed/blob/main/docs/apps.md)），但任务和测试仍然需要 Deno。

## 花 349 美元之前，怎么先试试 Seed？

打开[在线演示](https://app.seedsaas.com)：点一下就进入带示例数据的访客账户，两分钟内就能建团队、邀请成员、打开计费页面。合适就 clone [仓库](https://github.com/spy4x/seed)。不合适的话，Supastarter 是个好套件，[ShipFast 替代方案](/zh-CN/blog/shipfast-tidai)里还比较了另外七个。
