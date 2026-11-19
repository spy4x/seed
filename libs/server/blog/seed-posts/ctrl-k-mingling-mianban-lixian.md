---
slug: ctrl-k-mingling-mianban-lixian
language: zh-CN
translationOf: ctrl-k-command-palette-offline
title: "如何实现一个离线也能用的 Ctrl+K 命令面板"
seoTitle: "Ctrl+K 命令面板怎么实现：容错搜索，离线也能用"
description: "Ctrl+K 命令面板应该能操作整个应用，容忍拼写错误和切错的键盘布局，断网也照常工作。下面讲 Seed 如何用一份命令列表实现它。"
tldr:
  - "命令面板应该能操作应用，而不只是搜索。页面、创建操作和设置都是命令，按下 Enter 设置立即生效。"
  - "匹配词首，每个词允许一处拼写错误，再按另一种键盘布局读一遍查询。于是 “notse” 能找到 Notes，“ntvf” 能找到 Theme。"
  - "永远不要停在 “No results”。提议创建输入的内容，服务器连不上时搜索设备上的副本，需要联网的命令变灰显示。"
  - "让它保持为一份纯列表：输入应用状态，输出命令。快捷键来自应用唯一的快捷键列表，所以面板和快捷键对话框永远一致。"
topic: 深入解析
intro: "Seed 的 Ctrl+K 命令面板能操作整个应用，能透过拼写错误和切错的键盘布局找到东西，断网也照常工作。下面讲它能做什么，以及构建它的那一个文件。"
relatedFeature: shortcuts
coverAlt: "一个空白的紫色键帽在桌上发光，旁边是一根拔掉的网线，四张纸卡从键帽上升起，上面分别画着月亮、太阳、一页纸和一座房子。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-19T08:00:00Z
newsletter: true
---

怎样实现一个让人一直愿意用的 Ctrl+K 命令面板？让它做到三件事。第一，它能操作应用：每个页面、每个 “New…” 和每项设置都是一条命令。第二，它容忍人们真实的打字方式：拼错、只打半个词、键盘布局切错。第三，它从不把你带进死胡同：什么都没匹配上时，它提议创建你输入的东西；没有网络时，它搜索你设备上的副本。在 Seed 里，这一切都来自一个文件里的一份命令列表。

这篇文章写给正在给自己的 Web 应用加 Ctrl+K 的开发者。我先展示面板能做什么，再讲构建它的那个文件，配真实代码。

![Seed 的命令面板，搜索框里输入了 “ntvf”。第一行高亮，是 Settings 下的 Theme，旁边显示当前值 “System”。](/shots/palette-dark-800.webp)

## 除了搜索，Ctrl+K 还应该做什么？

打开面板，什么都不输入。它已经有用了：Recent（最近）下是你最近选过的五项，还有当前页面的命令、你最新的笔记，以及 Create（创建）。大多数时候打开面板，要么是“带我回到那个东西”，要么是“在这里做那件显而易见的事”，两者都不该需要打字。

接着它列出应用能做的一切，分在五个标题下：This page（本页）、Go to（前往）、Create、Settings（设置）和 Account（账号）。有几个决定被证明是值得的（文中的例子用的都是英文界面的应用）：

- **设置立即生效。** 输入 `light`，按 Enter：页面变亮，面板保持打开。输入 `dark`，Enter，又回来了。不用跑去设置页看自己喜不喜欢。
- **快捷键就在命令旁边。** New note 那一行显示它的快捷键 N。由两个键组成的快捷键，比如先按 G 再按 N 打开 Notes 页面，列在 Keyboard shortcuts 对话框里，而这个对话框读取的是同一份命令列表。谁都不需要速查表。
- **`>` 表示只看命令。** 查询以 `>` 开头，笔记和群组就不会挡路。
- **Enter 会等答案。** 面板对每次查询只给一个答案，笔记也包含在内。服务器还没回复你就按了 Enter，它会等，所以你永远不会打开半秒前碰巧排在第一的那一行。

只能找笔记的搜索框只是半个命令面板。另一半，才是人们愿意把手留在键盘上的原因。

## 它怎样透过拼写错误和切错的键盘布局找到东西？

输入 `notse`，第一行就是 Notes 页面。输入 `ntvf`，得到 Theme，就像上面那张图。第二个看起来像是猫从键盘上走过。其实它是 “тема”，俄语里的“主题”，只是键盘还停在英文布局上打出来的。我的键盘有英文和俄文两种布局，切错的次数多到 `ntvf` 已经成了一个测试用例。

匹配器遵循几条简单的规则：

1. 忽略大小写和变音符号。
2. 词的顺序随意，你输入的每个词只需是命令名称或某个别名中某个词的开头。`no all` 就足以找到 “all notes”。
3. 四个字母及以上的词可以带一处拼写错误：多一个字母、少一个字母、错一个字母，或者两个字母互换。
4. 查询还会按另一种键盘布局读一遍，并且跨字母表匹配，所以拉丁字母能找到俄语词，反过来也一样。

多行都匹配时，更干净的匹配胜出：完全相同的名称第一，然后是以查询开头的名称，然后是词匹配，然后是别名，然后是另一种布局，拼写错误排最后。所以容忍拼写错误永远不会把正确答案挤下去。

每条命令还带着人们会尝试的词，英文和俄文都有。Notes 能被 “all notes” 和 “заметки” 找到，Activity 能被 “history”、“log” 和 “audit” 找到。没人记得你给页面起的名字，他们记得的是自己会怎么叫它。

常见的替代方案是模糊匹配器，就是那种只要字母按顺序出现就算匹配的。它更适合文件选择器，在那里 `gtn` 应该找到 `go-to-notes.ts`。但对命令列表来说它太宽松了：几个字母就能匹配到和你本意毫不相干的行，而且它仍然不知道 `ntvf` 是一个词。词首加一处拼写错误更严格，正适合人起的短名称。

每个词一处拼写错误是上限。一个词里有两处错误就什么也找不到：它是匹配器，不是读心术。匹配器放在共享库 [`@spy4x/platform`](https://jsr.io/@spy4x/platform) 里，每条命令的名称只预处理一次，所以几百行在每次按键时重新排序，没人察觉得到。

## 什么都没匹配上时它显示什么？

“No results”（无结果）等于面板在叫你走开。Seed 的面板从不说这句话，因为你输入的任何内容，都是下一个东西的好标题。

输入 `Palette demo`。没有东西叫这个名字，于是 Create 区提议 `New note: “Palette demo”`。按 Enter 打开新建笔记表单，标题已经填好。按 Ctrl+Enter 则跳过表单：笔记直接创建并打开。

这些行是根据查询生成的，从不拿去和查询匹配，所以任何文本都能得到它们：

```ts
export function quickCreateRows(context: PaletteContext, query: string): PaletteOption[] {
  const { t, currentGroup } = context
  const title = query.trim()
  if (title === "") return []
  const writable = currentGroup?.canWrite && context.notes !== false ? currentGroup : null
  const row = (entity: QuickCreateEntity, key: string): PaletteOption => ({
    id: `quick-create-${entity}`,
    label: t.t(`Search.withText`, { label: t.t(key), text: isolate(quoted(title)) }),
    group: t.t(`Search.create`),
    choice: { kind: "quick-create", entity, title },
  })
  // ……此人在这里有写权限时，加一条笔记和一个标签，再加一个群组
}
```

没有写权限的 viewer 看不到 “New note” 这一行。面板只提供页面上的按钮会提供的东西。

## 它怎样在离线时继续工作？

没有网络时会出两种问题：搜索没人可问，有些命令没人来执行。面板分别处理。

**搜索回退到设备上。** Seed 的应用本来就在浏览器的本地数据库里保存一份你的笔记副本（也就是[离线优先那一层](/blog/offline-first-preact-signals-local-database-sync)（英文））。面板先问服务器，服务器连不上时就改为搜索那份副本：

```ts
return async (query, signal) => {
  if (query === "") return { notes: await recentNotes(sources), onDevice: !sources.canCall() }
  if (sources.canCall()) {
    try {
      const answer = await sources.server(query, signal)
      return { notes: answer.notes.map(fromWire), onDevice: false }
    } catch (error) {
      if (signal.aborted || !(isUnreachable(error) || isProxyAnswer(error))) throw error
    }
  }
  return { notes: await notesOnDevice(sources, indexOf, query), onDevice: true }
}
```

这就是 [`apps/spa/src/state/search.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/search.ts)。其中有三个细节很重要：

- 标题会变成 “Notes on this device”（本设备上的笔记），让你知道答案可能比服务器上的旧。
- 只有服务器不可达才会触发回退。拒绝，比如触发了频率限制，会显示为错误。把它藏在本地结果后面，等于礼貌地撒谎。
- 设备上可能还留着你已经退出的群组的笔记。搜索只在你当前所属的群组里查找。

本地搜索容忍同样的东西。在演示站里断开网络，输入两个 l 的 `pallette`，照样能找到 “Palette demo” 这条笔记。`зфдуееу` 也一样，那是同一个词在俄文布局下打出来的样子。

**需要服务器的命令留在列表里。** 离线时，“New group” 或 “Delete my account” 本可以悄悄从列表里消失。那样你会怀疑这个功能到底存不存在。所以它们留在原处，变灰显示，旁边写着 “Needs a connection”（需要联网）：

```ts
const SERVER_ONLY = new Set(
  [
    `import-notes`,
    `new-group`,
    `keep`,
    `download-data`,
    `change-picture`,
    `delete-account`,
    `turn-off-two-factor`,
    `end-other-sessions`,
  ].map((id) => `action-${id}`),
)

function needsServer(context: PaletteContext, option: PaletteOption): PaletteOption {
  return {
    ...option,
    disabledReason: context.online ? undefined : context.t.t(`Search.needsConnection`),
  }
}
```

New note 和 New tag 不在这份名单里。它们离线也能用：写入在队列里等着，网络恢复后再发出去。

## 它是怎么构建的？一份命令列表

整个注册表就是 [`libs/ui/palette-commands.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.ts)。它是一个纯函数：输入应用状态（你是谁、在哪个群组、是否在线），输出一份选项列表。没有 store，没有 `fetch`，没有路由。一条命令就是一个条目：

```ts
{
  id: "notes",
  key: `Frame.notes`,
  href: (context) => context.notes === false ? null : NOTE_PATHS.list,
  aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
},
```

标签的翻译键、要去的地方、能找到它的词。这个人去不了那里时，`href` 返回 `null`，这条命令就被略去。

看看这个条目里没有什么：它的快捷键。“先按 G 再按 N” 在这个文件里哪儿都没写。应用只有一份快捷键列表，面板按同一个翻译键去那里查快捷键：

```ts
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}
```

所以面板和 Keyboard shortcuts 对话框不可能不一致。另一种做法是把快捷键写在两个地方，它能一直正常工作，直到其中一处改了的那一天。对话框也会反过来读取同一个注册表，列出每条命令以及能找到它的词。

每个选项都带一个 choice，一个小对象，比如 `{ kind: "quick-create", entity, title }`。应用用它的按钮调用的同一个函数来执行它。面板永远不会长出第二套“创建笔记”的实现，然后和真正的那套渐行渐远。

因为是纯函数，测试起来很便宜：不需要浏览器，输入状态，输出行就行。测试读起来就像功能列表，比如 “put Go to Notes first for notse and заметки” 和 “keep each command the server must run listed offline, dimmed with why, and dim none online”。它们在 [`palette-commands.test.ts`](https://github.com/spy4x/seed/blob/main/libs/ui/palette-commands.test.ts) 里。

管理后台也有同样的命令面板。它的命令是第二份列表，268 行，其余部分全部共享。

## 产品怎样加入自己的记录？

Seed 是一个起步模板，所以面板得能找到我从没听说过的东西：你的发票、联系人、项目。产品以记录的形式把它们交给面板：

```ts
export interface PaletteRecord {
  /** Unique within its source. */
  id: string
  /** What the palette lists and matches, in the person's language. */
  label: string
  /** The row's second line, such as an amount or a date. It is shown, not matched. */
  detail?: string
  /** Other words that find it, such as a number or an old name. */
  aliases?: readonly string[]
  /** The page a pick opens, as a page command does. */
  href: string
}
```

一个来源就是一个标题加一个函数，函数返回设备当前持有的记录（[`search-palette.tsx`](https://github.com/spy4x/seed/blob/main/libs/ui/search-palette.tsx)）。它们在设备上由和命令相同的匹配器来匹配，所以发票也免费获得了对拼写错误和键盘布局的容忍，在线离线都一样。有一个坑：这个函数在每次按键时都会被调用，所以它必须从内存里作答，而且在没有变化时应该返回同样的对象。匹配器对每个对象只预处理一次，之后复用这份结果。

## 试着把它弄坏

打开[演示站](https://app.seedsaas.com/try)，点 “Try it now”（立即试用）。你会得到一个带示例笔记的访客账号。然后：

1. 按 Ctrl+K（Mac 上是 ⌘K），输入 `notse`，再输入 `ntvf`。
2. 输入 `light`，按 Enter，再输入 `dark`，Enter。
3. 输入一个没人用过的标题，按 Ctrl+Enter。
4. 在浏览器的开发者工具里断开网络，用一个带拼写错误的词搜索那条笔记。

全部代码都以 MIT 许可放在[代码仓库](https://github.com/spy4x/seed)里，快捷键列在[快捷键页面](/zh-CN/features/shortcuts)上。如果你发现某个它本该容忍却没容忍的拼写错误，那就是一个我还没写的测试。
