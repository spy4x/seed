---
slug: saas-moban-guodu-sheji
language: zh-CN
translationOf: over-engineering-a-saas-boilerplate
title: "我在 Seed v1 上犯的错：SaaS 模板的过度设计"
seoTitle: "SaaS 模板过度设计复盘：我在 Seed v1 上犯的错"
description: "Seed v1 完成了路线图的一半，却几乎没有完成用户真正会用的功能。SaaS 模板的过度设计在代码里是什么样子，以及 Seed 现在怎么做。"
tldr:
  - "Seed v1（2019 到 2022 年）勾掉了路线图 66 项中的 33 项，但网页客户端、管理后台、PWA 和文件上传这 17 项一项都没完成。"
  - "它有 31 个 Nx 项目、23 个 CQRS 消息类和 9 个云服务，围着的却只是数据库里的 3 张表。"
  - "过度设计是指把一个功能做得比它需要的更复杂，而不是功能做得太多。"
  - "现在的 Seed 按同一个复制来的模式把每个功能从头做到尾，跑在一台服务器上，v1 只停留在计划里的产品功能它全都有。"
topic: 踩坑
intro: "Seed 有过第一个版本，从 2019 年到 2022 年，而我把它设计过度了。下面是这件事在路线图、提交记录和目录结构里的样子，以及 Seed 现在换了什么做法。"
relatedFeature: deploy
coverAlt: "一座高高的紫色脚手架围着盆里一株极小的幼苗，旁边一个普通花盆里，一株大植物自己长得很好。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

我在 Seed v1 上犯了什么错？过度设计：产品还没有，我先给一个大产品搭好了脚手架。它自己的路线图就能说明这一点。66 项里勾掉了 33 项，而勾掉的这一半大多是工具和后端管线：monorepo、严格的 lint 规则、pre-commit 钩子、CQRS 基类、部署到 Google Cloud。另一半里留着几乎所有用户真正会用的东西：群组、支付、实时更新、离线使用、文件上传和管理后台。

这篇文章写给正在做自己的 SaaS 模板（boilerplate），或者第一个 SaaS 的开发者：如果你怀疑自己一直在打磨车间，却没在做家具，那就是写给你的。下面每个数字都来自代码：v1 至今还在仓库里，标签是 [`v1-final`](https://github.com/spy4x/seed/tree/v1-final)，我用来统计的命令写在添加这篇文章的[合并请求](https://github.com/spy4x/seed/pull/823)里。没有靠回忆，全是数出来的。

## Seed v1 是什么？

用它 README 里的话说，是一个“full-stack startup monorepo template”，号称从第一天起就用最佳实践。前端是 Angular，后端是 Nest.js 和 Prisma 加 PostgreSQL，登录用 Firebase，运行在 Google Cloud 上，用 Nx 把一切串起来，用 Yarn 安装。第一个提交在 2019 年 6 月 16 日，最后一个在 2022 年 12 月 23 日：三年半，134 个提交。

它不是慢慢淡出的，而是突然停了：其中 55 个提交集中在最后两个月，之后就再没有动静，直到 2026 年 1 月 26 日 Seed 以一段全新的历史重新开始。

## 路线图承诺了什么，实际做出了什么？

README 里的路线图把每一项标为已完成或计划中。它最后一次更新是 2022 年 11 月 25 日：

| 路线图分区                     | 已完成 | 计划中 |
| ------------------------------ | -----: | -----: |
| 开发环境与代码组织             |      8 |      7 |
| 后端                           |     14 |      5 |
| 数据库                         |      3 |      1 |
| 共享前端（登录、状态、测试）   |      6 |      3 |
| 样式                           |      2 |      0 |
| PWA（离线、推送、可安装）      |      0 |      4 |
| 文件上传                       |      0 |      4 |
| 管理后台                       |      0 |      3 |
| 网页客户端（群组、实时、账户） |      0 |      6 |
| **合计**                       | **33** | **33** |

Stripe 订阅在后端分区里，标着计划中。管理后台的用户列表倒是在 2022 年 12 月做出来了，那时路线图已经不再更新，这一项就算 v1 的。

33 个对勾里有 3 个是自动备份、从备份恢复和只读副本。每一项都链接到 Google Cloud SQL 的文档，而基础设施文档自己写着复制功能“not yet used”。我是在给 Google 做完的作业打勾。

## 工作都花到哪里去了？

花在车间里。提交信息里写着类型，它们讲这个故事比我讲得更清楚：

- **134 个提交里有 52 个类型是 `env` 或 `environment`**：配置、工具、CI、升级和改名。`feat` 只有 31 个。
- **第一个让人能做点什么的提交**（一个简单的用户 API：注册、读取和更新自己的资料）是第 38 个，日期是 2021 年 5 月 31 日，距第一个提交将近两年。前 37 个提交里有 28 个是 `environment`。
- **CI 搭了三次**：2019 年 7 月用 GitLab CI，2021 年 3 月换成 GitHub Actions，2021 年 6 月又换成 Google Cloud Build。可最后一版路线图里，CI/CD 仍然写着计划中。
- **2021 年 2 月两天里给应用和目录改了四次名**，一年后还有一个叫“massive refactoring”的提交。

## 这么少的数据，配了多少结构？

v1 的数据库 schema 只有三个模型：`User`、`UserDevice` 和 `Notification`。围绕它们的是：

- **31 个 Nx 项目**：三个应用、两个端到端测试应用和 26 个库。光是前端共享的登录就拆成了四个库：container、guards、state 和 UI。
- **65 个 `index.ts` 文件**，其中 63 个只是在重新导出别的文件。
- **一层自带基类的 CQRS**，建在命令、查询和事件总线之上，承载 11 个命令、5 个查询和 7 个事件，外加 19 个处理器。
- **9 个云服务**，列在基础设施文档里（Cloud Run、Cloud SQL、Cloud Tasks、Cloud Logging、Cloud IAM、Firebase Authentication、Hosting 和 Storage，再加 Sentry），还有一份标着“WIP”、从手动步骤开始的初始化指南。
- **104 个 npm 包**，写在根目录的 `package.json` 里，其中 50 个是运行时依赖。

作为对比，现在的 Seed 有 73 张表，workspace 包是 34 个。结构如今跟着数据一起长，而不是抢在数据前面。

## 问题出在功能太多吗？

不是，这一点我想讲准确。过度设计是指把一个功能做得比它需要的更复杂：多余的分层、为极少见的时序问题加的防护、没人会跑的自动化。它不等于“这个功能没必要”。v1 的愿望清单本身没问题。现在的 Seed 拥有 v1 只停留在计划里的全部产品功能，还不止这些：通行密钥（passkey）和双重验证、带角色和邀请的群组、按成员计费的 Stripe 订阅、实时更新、能离线使用的应用、文件存储、独立域名上的管理后台，以及包括中文在内的九种语言（[README](https://github.com/spy4x/seed#readme)）。

它甚至仍然在用 CQRS：命令、查询和事件各走各的总线，每次群组变更都把事件写进 outbox，由 worker 来处理。模式本身从来不是罪魁祸首。罪魁祸首是一个群组都还没有的时候，就先写了四个登录库。

## Seed 现在换了什么做法？

- **每个功能只有一种模式。** 新功能按固定顺序，一个文件一个文件地复制笔记功能：[笔记聚合的全部文件](/zh-CN/docs/aggregates)。指南说得很直白：“Do not invent a second shape”，别发明第二种模式。
- **一台服务器，而不是九个服务。** Docker Compose 在你自己掌控的服务器上运行应用、Postgres、代理和监控：[从 git clone 到在一台 Hetzner 服务器上线](/blog/deploy-saas-to-one-hetzner-server)（英文）。
- **会说“不”的原则。** [Seed 的原则](https://github.com/spy4x/seed/blob/main/docs/principles.md)里有“Ship small, safe slices”“Avoid speculative complexity”和“Add deps only with clear ROI”：小步、安全地交付，不为“万一”提前堆复杂度，只有明显划算时才加依赖。
- **Web 标准优先于框架。** 服务端说的是 Fetch、Web Crypto 和 WebSocket，而不是某个平台的私有 API：[为什么 Seed 建立在 Web 标准之上](/blog/why-seed-free-saas-starter-web-standards)（英文）。

提交类型也变了。重新开始以来，Seed 的 531 个提交里，`feat` 有 194 个，`chore`、`ci` 和 `build` 加起来 46 个。其中大多是 squash 合并的合并请求，所以和 v1 的提交大小不一样，但方向很清楚。

## 你的模板是不是也在这样做？

从 v1 的数字里总结出三个快速检查：

1. 数一数你的目录和你的表。库比表还多，就该警惕了。
2. 读一读路线图里“计划中”的那一半。如果用户会碰到的东西全在那里，你就是在造车间。
3. 找出第一次能让人做点什么的那个提交。如果是第 38 个，你好，那就是我。

或者干脆跳过脚手架：[Seed](https://github.com/spy4x/seed) 免费、MIT 许可，地基已经打好。克隆下来，这周就[上线你的第一个功能](/blog/your-first-feature-copy-the-notes-aggregate)（英文）。
