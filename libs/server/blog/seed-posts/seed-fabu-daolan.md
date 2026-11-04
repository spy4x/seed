---
slug: seed-fabu-daolan
language: zh-CN
translationOf: welcome-to-the-seed-blog
title: "Seed 发布了：逐个页面看这款免费 SaaS 模板"
seoTitle: "Seed 发布：免费开源 SaaS 模板，逐页导览"
description: Seed 是一款 MIT 许可的免费 SaaS 模板，现在就能用。逐个页面看第一天就能用的功能、还没做的部分，以及一分钟上手的方法。
tldr:
  - Seed 是一款 MIT 许可的免费 SaaS 模板，现在就能用。复制一个仓库，每一行代码都归你。
  - "已经做好：通行密钥和双重验证、带角色的群组、通过 Stripe 按成员计费、实时更新、离线可用、管理后台和九种语言。"
  - "还没做：Android 应用和桌面应用。"
  - 演示一键打开，本地四条命令就能跑起来。
topic: Seed
intro: "Seed 是我公开开发的免费 SaaS 模板，现在可以用了。我逐个页面带你看第一天就能拿到什么、还缺什么，以及怎样一分钟上手。"
coverAlt: "花盆里的一株紫色幼苗，旁边是一个打开的信封，叶子像信件一样从里面飘出来。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

Seed 发布了。这是一款 MIT 许可的免费 SaaS 模板，今天就能用：复制一个仓库，登录、带角色的群组、通过 Stripe 按成员计费、实时更新、可离线使用的应用、管理后台和九种语言就都已经在运行了。它跑在你自己掌控的一台服务器上，用的是 Postgres 和 Docker Compose。什么都不用装，就能在[在线演示](https://app.seedsaas.com)里把应用点一遍。

我是 Anton，平时为客户做 SaaS 的 MVP。以前每个项目开头都是同样一个月的“管道活”：登录、团队、计费，还有一个我每次都说“以后再弄好看”的管理页面。Seed 就是把这一个月的活一次做完，并且持续更新。这篇文章是一次导览；和其他模板的客观对比，请看[免费开源 SaaS 模板](/zh-CN/blog/mianfei-kaiyuan-saas-moban)。

## 用户怎么登录？

大家期待的方式都有：带验证码的邮箱加密码、通行密钥（passkey）、Google 和 GitHub，以及通过邮件发送的登录码。用验证器应用开启双重验证，只需在安全页面上拨一个开关；同一页面还列出所有已登录的设备，看到陌生的会话可以直接结束。访客也可以一键以游客身份开始，之后再添加登录方式，数据不会丢。

![个人资料的安全页面：密码、“添加通行密钥”按钮、已开启的双重验证，以及已登录设备列表的开头部分。](/shots/profile-security-dark-800.webp)

从来没有人因为“忘记密码”好用而注册一个产品，但因为它不好用而离开的人可不少。不花钱买身份验证服务是怎么做到的，见 [Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas)（英文）。

## 团队怎么运作？

靠群组。注册时，账号、会话和第一个群组在同一个数据库事务里创建，所以个人空间和团队是同一种东西，遵守同样的规则。成员通过邮件邀请，并分配四种角色之一：查看者、编辑者、管理员或所有者。所有者可以把群组转交给别人，删除的群组 30 天内可以恢复。

![一个群组的成员列表，每位成员都标有角色，有一个邀请按钮，其中一位成员的菜单已打开：设为查看者、设为管理员、移出群组。](/shots/group-members-dark-800.webp)

## 计费是什么样的？

每个群组一份 Stripe 订阅，按成员计费。演示的套餐里有一个免费套餐（最多 3 位成员、10 条笔记），以及每位成员每月 €9 的 Pro 套餐（含所有者），带 14 天试用。数量跟着成员人数变化，所有者在每次邀请前确认新价格；银行卡扣款失败时会有宽限期，而不是立刻锁定。这些价格只是示例：你的套餐就是一个文件里的列表（[计费套餐文档](/docs/billing-plans)，英文）。

![演示应用中一个示例群组的套餐，按演示用的示例价格显示：Pro 套餐及其续订日期，每月 €36.00，共 4 位成员，每人 €9.00，含所有者。](/shots/billing-plan-dark-780.webp)

四个人的团队用 Pro 每月付 €36。拖动滑块，看看你的团队要付多少。

<CostCalculator members={4} />

## 两个人同时编辑，或者 Wi-Fi 断了，会怎样？

改动通过 WebSocket 送到每个打开的标签页；连接断开时，请求改走普通 HTTP。应用可以安装，没有网络也能打开，从 IndexedDB 读取最近的笔记和群组，并把对笔记的修改排进队列，等网络恢复再发送。如果这期间有人改了同一条笔记，你会看到一个需要处理的冲突，绝不会悄悄覆盖同事的工作。

![一个名为 Acme Studio 的团队的笔记页面：六条笔记，带作者、彩色标签和更新时间，一个搜索框，按标签和作者筛选，以及“新建笔记”按钮。](/shots/notes-dark-800.webp)

笔记是参考功能：你的第一个功能就是照着它逐个文件复制出来的（[你的第一个功能](/blog/your-first-feature-copy-the-notes-aggregate)，英文）。详细内容见两篇英文文章：[基于 WebSocket、以 HTTP 兜底的实时更新](/blog/realtime-websocket-with-http-fallback)和[本地数据库如何同步](/blog/offline-first-preact-signals-local-database-sync)。

## 运营人员能看到什么？

一个运行在独立域名上的管理后台。运营人员可以找到某个用户，查看他的登录方式、会话和群组，退款，写这个博客，管理邮件订阅者，以及重跑失败的任务。危险操作会先确认，每个操作都会记进审计日志。

![管理后台的用户页面：按姓名或地址搜索，按状态、账号类型和角色筛选，以及一张列出虚构用户及其角色、状态和最后在线时间的表格。](/video/admin-panel-poster-1280.webp)

应用的每个功能都会在同一次改动里配上自己的管理页面，两边永远不会脱节（[管理后台如何保持同步](/blog/admin-panel-for-every-feature)，英文）。

## 支持哪些语言？

九种：简体中文、英语、德语、西班牙语、法语、巴西葡萄牙语、俄语、日语，以及从右往左书写的阿拉伯语。应用、管理后台、这个网站和邮件都会跟着切换，所以你可以在第一位阿拉伯语客户替你发现 bug 之前，自己先检查阿拉伯语下的布局（[九种语言和从右到左](/zh-CN/blog/seed-duoyuyan-rtl)）。

## 还有什么没做？

Android 应用（[#202](https://github.com/spy4x/seed/issues/202)）和桌面应用（[#203](https://github.com/spy4x/seed/issues/203)）。其余计划在[未关闭的 issue](https://github.com/spy4x/seed/issues) 里。Google 和 GitHub 登录以及 Stripe 计费需要你自己的密钥，所以在演示中是关闭的，演示显示的是虚构的付款。管理后台也不在演示里：[有一段视频展示它](/zh-CN/admin)。

Seed 也不是什么项目都适合。如果你要部署到 serverless 函数，或者想要托管好的后端，请选别的方案：Seed 默认你自己运维一台服务器。

## 怎么试用？

两种方式，各一分钟：

- **在线演示。** 点“免账号试用”，会打开一个装满示例数据的游客账号：一个你拥有的群组，外加两个由虚构人物组成的团队。演示每晚清空，随便折腾。
- **在你自己的电脑上。** 准备好 Deno 2 和 Docker，然后四条命令。[Get started](/docs/get-started) 指南一步步讲解，[安装文章](/blog/install-seed-and-run-it-locally)展示真实的输出和常见的坑（均为英文）。

先从演示开始：[现在打开](https://app.seedsaas.com)，点“免账号试用”，去别人的团队里逛逛。
