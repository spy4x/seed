---
slug: seed-zhichi-deno-node-bun
language: zh-CN
translationOf: seed-runs-on-deno-node-and-bun
title: "Seed 现已支持 Deno、Node 和 Bun"
seoTitle: "支持 Node.js、Bun 和 Deno 的 SaaS 模板：Seed 三种运行时都能跑"
description: "免费的 SaaS 模板 Seed 现在无需改代码即可在 Deno、Node.js 和 Bun 上运行。如何在你的运行时上新建产品、如何切换已有产品，以及哪些部分仍然需要 Deno。"
tldr:
  - Seed 的 API、后台 worker、数据库迁移和网站现在无需修改即可在 Deno、Node 和 Bun 上启动，CI 在每个 pull request 上都会在三种运行时上验证。
  - env 文件里的一行 APP_RUNTIME=node 或 bun 就能切换服务器的运行时。不写这一行就保持 Deno，所以什么都不改的产品照常运行。
  - 公开网站从 Fresh 换成了一个小巧的层，路由、页面和 island 都和原来一样，每个页面加载的 JavaScript 都更少了。
  - 任务和测试仍然跑在 Deno 上；npm 或 Bun 会帮你装好 Deno。
topic: 更新日志
intro: "Seed 不再绑定单一运行时。它的服务器无需改代码就能在 Deno、Node 和 Bun 上启动，用哪个由 env 文件里的一行决定。下面说明这对新产品意味着什么，以及已经在运行的产品需要做什么。"
coverAlt: "山丘顶上一盆紫色的嫩芽，三条小路通向它：一条是踏脚石，一条是木板，一条是碎石。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-10T09:00:00Z
newsletter: true
---

免费开源的 SaaS 模板 Seed 现在可以运行在 Deno、Node.js 和 Bun 上。API、后台 worker、数据库迁移和
公开网站在三种运行时上都无需修改一行代码即可启动，CI 会在每个 pull request 上把 API、worker 和
网站在三种运行时上各启动一遍。产品服务器用哪个运行时，由 env 文件里的一行决定；不写这一行，就
全部保持在 Deno 上。

这篇文章写给两类读者：一类正在挑选 SaaS 脚手架，不想把产品押在单一运行时上；另一类已经在用
Seed 做产品，下一次同步就会拿到这项改动。每一节回答一件你可能要做的事。迁移本身的经过，包括踩过
的坑，写在[我的博客](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun)上（英文）。

## 怎样在我用的运行时上新建产品？

README 的快速开始现在为每个运行时各写了一节：
[Node](https://github.com/spy4x/seed#node)、[Bun](https://github.com/spy4x/seed#bun) 和
[Deno](https://github.com/spy4x/seed#deno)。你需要 Docker，再加三者之一。用 Node 的话：

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

没错，第一行装的是 Deno。为了摆脱 Deno 先装上 Deno，这事比我希望的要好笑，但 Seed 自己的任务
目前还跑在 Deno 上（下文会讲），而 npm 上有 `deno` 包，所以只有 Node 的机器不需要再装别的。用 Bun
的话，第一行换成 `bun add -g deno`，最后两行换成 `bun run init` 和 `bun run dev`。`gh` 那一行可以
不用：在 GitHub 上点 "Use this template" 再 clone，效果一样。

这样你就在 Docker 里跑起了基于 Deno 的完整技术栈。如果想让产品的服务器也跑在 Node 或 Bun 上，在
运行 `dev` 之前往 `infra/envs/.env` 里加一行：

```sh
APP_RUNTIME=node   # 或 bun；写 deno、留空或不写这一行都保持 Deno
```

## 在 Node 或 Bun 上运行哪些部分，有什么不同？

设置 `APP_RUNTIME=node` 或 `bun` 后，API、worker、迁移和网站会各自从专门的 Docker 镜像运行在
Node 26 或 Bun 1.4 上。端口、环境变量和服务的启动顺序都不变。SPA 和管理后台是静态文件，不受影响。
完整说明见[文档的运行时一节](/zh-CN/docs/apps#runtime)。

切换之前，最好先知道与 Deno 的三点不同：

- **没有 watch 模式。** 代码在镜像里打包，所以在 Node 或 Bun 上，即使是开发环境，改了代码也要
  重新构建镜像才能看到。带热重载的开发仍然在 Deno 上进行。
- **worker 没有运行时权限限制。** 在 Deno 上，worker 只能读写自己的图片目录，也只能运行 `vips`。
  Node 和 Bun 没有这种限制，在那里约束 worker 的只有它的容器和非 root 用户。
- **由你决定。** 不写这一行、留空或写 `deno`，都保持在 Deno 上。

## 我已经有一个基于 Seed 的产品，该怎么做？

照常同步即可，按[产品指南](/zh-CN/docs/products)的步骤：拉取 Seed，应用补丁，记录提交：

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

然后在打开 pull request 之前运行 `deno task check`。我在一份运行时改动之前的 Seed 副本上试过这次
同步，补丁没有任何冲突就应用上了。你的产品在你有意改过 Seed 文件的地方可能会有冲突：按指南的说法，
保留你自己的版本。

这次同步会加入 Node 和 Bun 的 Docker 镜像、切换到它们的 Compose 文件，以及仓库根目录的
`package.json`。它不会改变你正在用的运行时。想切换时，在 `infra/envs/.env` 里设置
`APP_RUNTIME=node`（或 `bun`），然后重新构建镜像：

```sh
deno task compose up -d --build
```

在服务器上，把同一行写进服务器的 env 文件，然后照常部署（[更新](/zh-CN/docs/deploy-updates)）：
每次部署都会构建这一行指定的镜像。

## 公开网站有什么变化？

网站不再运行在 Fresh 上，而是换成了
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server)。这是一个小巧的开源层，照搬了
Fresh 2 的路由、页面和 island，所以网站代码几乎没变。我在两个构建上请求了所有路由并比对响应：
423 个响应中有 419 个完全相同。不同的 4 个是某个视频的修改时间和 ETag，以及一个格式错误的地址：
以前它得到的是一个光秃秃的错误，现在得到的是网站自己的 404 页面。

页面也变轻了。每个页面经 gzip 压缩后的 JavaScript 体积，用 Lighthouse 移动端测得：

| 页面                 | 新的层  | Fresh   |
| -------------------- | ------- | ------- |
| 首页                 | 24.0 KB | 32.1 KB |
| 带 island 的博客文章 | 29.9 KB | 38.0 KB |
| 文档                 | 8.6 KB  | 19.4 KB |

在带交互式滑块的那篇文章上，页面阻塞输入的时间是 5 毫秒，Fresh 则是 48 毫秒。这个层的第一个
版本恰恰在这里比 Fresh 慢，而 CI 没有发现；我是怎么发现的，写在
[完整的故事](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun)里。

如果你改过自己产品的网站，同步之后可能还剩一些文件在从 Fresh 导入。在仓库根目录下这样找：

```sh
grep -rlE 'from "fresh' apps/mpa
```

把每个导入改成 `@spy4x/preact-server`（`fresh/runtime` 也一样），并把 `FreshContext` 改名为
`Context`。构建目录现在是 `dist`，不再是 `_fresh`。页面里不再有内联脚本，所以安全响应头也不再需要
每个请求一个 nonce。这个层还是第一个版本：它提供什么、省略了什么，见
[它的文档](https://github.com/spy4x/seed/blob/main/docs/website-server.md)。

## 哪些部分仍然需要 Deno？

工具链：格式化、lint、类型检查、测试，以及 `deno task` 背后的脚本。根目录的 `package.json` 会把
常用任务转交给 Deno，所以 `npm run test` 和 `bun run dev` 同样能用。测试仍然使用 Deno 的测试运行器。
这一点是否改变，由定在 2027 年 1 月 10 日的评审决定
（[运行时策略](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)）。这些都不会让用户
访问的服务器运行时被绑定在 Deno 上。

## Seed 为什么不再依赖 Deno？

2026 年 10 月 9 日，Deno 团队[宣布](https://deno.com/blog/cloudflare)再提供一年的错误修复和安全
更新，之后停止自身的开发。Deno 仍然是开源的，我也依然喜欢它。但一个你要在上面做生意的模板，不该
把你的产品押在某一个运行时的路线图上，我自己的路线图也一样。Seed 本来就建立在 Web 标准之上
（Fetch、Web Crypto、WebSocket、ES 模块），所以真正难的是文件服务、公开函数签名里的 Deno 类型，
以及网站这一层，而不是推倒重写。

在你已经在用的运行时上试试[快速开始](https://github.com/spy4x/seed#quick-start)。如果哪一步失败了，
带上你运行的命令[提一个 issue](https://github.com/spy4x/seed/issues)，我来修。
