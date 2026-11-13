---
slug: financy-seed-chongjian-1
language: zh-CN
translationOf: rebuilding-financy-on-seed-part-1
title: "用 Seed 重建 Financy（一）：在 SaaS 模板上做一个真实产品"
seoTitle: "用 Seed 重建 Financy：在 SaaS 模板上做真实产品"
description: "我正在用 Seed 重建 Financy，我的开源记账应用。第一篇：为什么推倒重来、副本是怎么开始的，以及和 Seed 的第一次同步结果如何。"
tldr:
  - "我的开源记账应用 Financy 以 Seed 副本的身份重新开始。旧版本冻结在一个分支里，作为它曾经能做什么的参考。"
  - "第一个提交是 Seed 的文件，加上 Financy 自己的 19 个文件：许可证、README、代理规则、产品文档和两个 .seed 文件。"
  - "第一次同步发生在复制后一天、换完品牌之后，带来了 Seed 的 19 个提交、616 个文件，没有任何冲突。"
  - "目前还没有任何记账功能。任何产品都需要的东西先在 Seed 里做，Financy 再通过同步拿到。"
topic: 公开构建
intro: "我正在用 Seed 重建 Financy，一个面向个人或家庭的开源记账应用，并且边做边写。第一篇：为什么扔掉旧代码，一个产品如何从 Seed 起步，以及第一次同步是什么样子。"
coverAlt: "一株年轻的紫色植物从开裂的灰色花盆移进新的紫色花盆，旁边一株大的紫色植物在给它浇水。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

能不能在 SaaS 模板上做一个真实的产品，同时还能持续拿到模板的更新？我现在正用
[Financy](https://github.com/spy4x/financy) 做这件事。Financy 是我做的免费开源（AGPL-3.0）记账应用，
面向个人或家庭。2026 年 11 月 3 日，Financy 作为 Seed 的副本重新开始；11 月 4 日，它拿到了第一批 Seed
的更新：19 个提交、616 个文件、零冲突。这个系列会跟着重建的进度一路记录。

这篇文章写给正在挑选 SaaS 模板、想看看它在演示之外的真实产品里表现如何的开发者，也写给对 Financy
感兴趣的人。这里的一切都是公开的：每个数字都来自 GitHub 上的两个仓库，你可以自己用 git 数一遍。

## 为什么重建 Financy，而不是修修补补？

第一版 Financy 从 2025 年 4 月开始，积累了 157 个提交。它能管理多种货币的账户、在货币之间换算，也有端到端
测试。但它也有我不再信任的代码：很多是当年借助那时的 AI 模型匆忙写出来的，要变成我想要的产品，它的结构、
状态管理和同步本来就都得重写。

答案的另一半，是 Financy 缺的东西。一个家庭记账应用需要带双因素认证的登录、带角色的群组、在所有设备上
实时更新、能离线使用的应用、管理后台和公开网站。这些是任何 SaaS 的基础设施，不是记账本身，而我刚好用整个
10 月把其中大部分做进了 Seed（[10 月新增内容](/blog/whats-new-in-seed-october-2026)，英文）。在 Financy 里再写
一遍，恰恰是 Seed 想帮人避免的错误。

所以旧版 Financy 冻结在 [`legacy`](https://github.com/spy4x/financy/tree/legacy) 分支里。它是 Financy
**做什么**的参考（功能、记账规则、边界情况），从来不是**怎么做**的参考：连一个辅助函数都不搬。从旧代码里
拿来的记账规则只是假设：先变成测试，再写新代码。

## Financy 是怎么从 Seed 起步的？

一个拉取请求：[financy#83](https://github.com/spy4x/financy/pull/83)。内容是 Seed 的文件，加上让副本
变成 Financy 的 19 个文件。这个数字是我把 Financy 的第一个提交和它记录的 Seed 提交对比后数出来的：

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

这 19 个文件是：AGPL-3.0 许可证（Seed 的 MIT 声明单独放在一个文件里）；一份坦白说明应用还不能用的
README；Financy 的 `AGENTS.md`，也就是每个参与的智能体和人都要遵守的规则；产品文档；发布流水线里的镜像名，
保证 Financy 的标签永远不会覆盖 Seed 的镜像；删掉的 4 个 Seed 加密服务器配置文件；以及让同步成为可能的
两个文件。

这两个文件就是全部诀窍。`.seed/commit` 记录副本对应的 Seed 提交，`.seed/skip` 列出 Financy 永远不接收
更新的 Seed 路径，比如 README。同步就是从这个提交到 Seed 当前 `main` 的 `git diff`，用三方合并应用。完整
步骤在
[Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates)
（英文）里，这篇讲的是我真正照着做之后发生了什么。

## 第一次同步真的成功了吗？

成功了，而且我还故意给它设了个小陷阱。同步之前，Financy 已经改过 Seed 的文件：
[financy#123](https://github.com/spy4x/financy/pull/123) 给了它名字、一个钱包图标和自己的蓝色，替换掉
Seed 的紫色，涉及 32 个文件。只能在没动过的副本上成功的同步，证明不了什么。

接着，[financy#127](https://github.com/spy4x/financy/pull/127) 把 Seed 从 `ec61062b` 升到
`d9641f03`。这是 Seed 的 19 个拉取请求、616 个改动文件，`git apply --3way` 一次应用，没有冲突。其中包括：

- 用邮件里的验证码登录；
- 月付价格旁边的年付价格；
- 整个群组共用的时区；
- 除了 Deno，API 和 worker 也能在 Node 和 Bun 上运行；
- 一个设置，决定产品的更新日志从哪里开始。

这次同步也暴露了一个产品要手动做的步骤。Seed 刚加了 `AGENTS.seed.md`，这是 Seed 自己仓库的规则；
Financy 删掉了它，并写进 `.seed/skip`，这样以后的同步不会再把它带回来。同步之后，Financy 和 Seed 有 59 个
文件不同，每一个都是 Financy 有意改的。

## 什么该放进 Seed，而不是 Financy？

任何 SaaS 都需要的东西。Financy 的 `AGENTS.md` 规定了顺序：任何项目都能用的代码放进共享库
`@spy4x/*`；任何基于 Seed 的产品都需要的代码放进 Seed；只有记账产品才需要的东西（账户、交易、预算、汇率）
才留在 Financy。不写“以后再搬”的本地临时实现：“以后”正是分叉越走越远的原因。

上面列表里有三项正是这样。Financy 需要按年计费，一个家庭的“一个月”需要所有成员共用一个时区，它的更新日志
也不能从旧应用好几年的提交开始。这些都和钱无关，所以都先在 Seed 里实现，再通过同步来到 Financy。11 月 3
日和 4 日，Seed 新开了 31 个提到 Financy 的 issue，到 11 月 5 日其中 8 个已经关闭。

重建还发现了我自己步骤里的漏洞。产品要从 Seed 网站上去掉的东西的清单漏了好几个文件；第 1 步记录的是 Seed
最新的提交，而它可能比副本更新，这样第一次同步就会悄悄跳过中间的提交。两处都已在 Seed 修好
（[seed#811](https://github.com/spy4x/seed/pull/811)），[指南](/zh-CN/docs/products)现在会告诉你如何找到
和你的文件完全一致的那个提交。这个修复对你比对我更有用：下一个基于 Seed 的产品不会再踩这个坑。

## 还有什么没做完？

几乎全部。在我写这篇文章时，Financy 就是换上了 Financy 名字、许可证和颜色的 Seed。账户、交易、预算的页面都
还没有，所以现在请先别用。连名字都还没定：[financy#126](https://github.com/spy4x/financy/issues/126) 在讨论
上线前要不要改名。

计划是公开的：[Financy 的 issue](https://github.com/spy4x/financy/issues) 分成 7 个里程碑，从打地基到上线，
再到上线之后。它们在 Seed 里碰到的每个缺口都会在 Seed 里修好，所以这个系列会同时展示两边：Financy 需要了
什么，Seed 又从中学到了什么。

## 继续关注

[Watch Financy 的仓库](https://github.com/spy4x/financy)，就能看到每个拉取请求落地；订阅这个博客，第二篇会
发到你的邮箱。如果你正要开始自己的产品，[指南](/zh-CN/docs/products)就是 Financy 在用的那一份；如果某一步在
你那里失败了，请[提一个 issue](https://github.com/spy4x/seed/issues)：这说明步骤里还少一行。
