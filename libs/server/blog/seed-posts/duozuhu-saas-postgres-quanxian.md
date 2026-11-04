---
slug: duozuhu-saas-postgres-quanxian
language: zh-CN
translationOf: multi-tenant-saas-groups-roles-postgres
title: "多租户 SaaS：在 Postgres 里做群组、角色和权限检查"
seoTitle: "多租户 SaaS 怎么做：Postgres 里的群组、角色与权限检查"
description: "Seed 如何在一个 Postgres 数据库里隔离租户：每一行都带群组 id，四个固定角色，每个处理器都检查角色，每次写入都在锁下重新读取角色。"
tldr:
  - "在 Seed 里，租户就是群组。每一行都带 group_id，一个人的访问权限就是 group_members 里的一行，角色从 1 到 4。"
  - "谁能做什么，是一组小而纯的函数。每个处理器读取角色再调用其中一个；WebSocket 和 HTTP 共用同一套处理器。"
  - "每次写入都在自己的事务里加锁重新读取角色，所以刚被移除的成员没法再挤进最后一次写入。"
  - "不使用行级安全（RLS）。外人得到 404 而不是 403，测试会检查一个群组永远看不到另一个群组的数据。"
topic: 深入解析
intro: "每个面向团队的 SaaS，在每个请求上都要回答同一个问题：这个人能不能动这一行？下面用真实代码讲 Seed 如何在一个 Postgres 数据库里回答它，以及它唯一一处用安全换简单的地方。"
coverAlt: "一座被分成多个玻璃隔间的温室，每间都有自己的植物和一扇紫色的门，每扇门旁都挂着一把钥匙。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

在 Postgres 上做多租户 SaaS，怎样保证一个团队永远看不到另一个团队的数据？在 Seed 里，租户就是**群组**。属于某个租户的每一行都带 `group_id`，一个人的访问权限是 `group_members` 里带角色的一行，每个请求在读写之前都会在代码里检查这个角色。写入要检查两次：一次在处理器里，一次在写入自己的事务里，并且加锁。一个共享数据库，一套表结构，不用行级安全（row-level security）。

这篇文章写给正在做团队产品、想看一个完整可运行方案而不是一张架构图的开发者。全部代码都在 MIT 许可的 [Seed 代码](https://github.com/spy4x/seed)里，下面的片段是真实代码，略有删减。

## Seed 里的租户是什么？

群组。没有单独的“个人”类型：注册时会创建一个名为 “Personal” 的普通群组，你是唯一的成员。所以单个用户和 50 人的团队走的是同一套代码，有人邀请同事时也不需要做任何迁移。一个人可以加入任意多个群组。

成员关系就是一张表（[迁移文件](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)）：

```sql
CREATE TABLE group_members (
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INT4 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INT2 NOT NULL,
    ...
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role_check CHECK (role BETWEEN 1 AND 4)
);
```

有两条规则由 Postgres 自己守住：角色只能是 1 到 4，一个部分唯一索引保证每个群组恰好一个所有者。转让所有权时，在同一个事务里先把旧所有者降级，再把新所有者升级，因为这个索引连一瞬间的两个所有者都不允许。每个功能的数据行（笔记、标签、文件）也都有自己的 `group_id` 列。

## 有哪些角色，各自能做什么？

四个，固定且有顺序：viewer（1）、editor（2）、admin（3）、owner（4）。有了顺序，大多数规则只需一次比较：“editor 及以上”就是 `role >= 2`。

| 操作                             | Viewer | Editor | Admin  | Owner |
| -------------------------------- | ------ | ------ | ------ | ----- |
| 读取群组的笔记                   | 可以   | 可以   | 可以   | 可以  |
| 创建、编辑和删除笔记             | 不可以 | 可以   | 可以   | 可以  |
| 以 viewer 或 editor 身份邀请他人 | 不可以 | 不可以 | 可以   | 可以  |
| 重命名群组、查看成员邮箱         | 不可以 | 不可以 | 可以   | 可以  |
| 把某人设为 admin                 | 不可以 | 不可以 | 不可以 | 可以  |
| 付款、删除群组、转让所有权       | 不可以 | 不可以 | 不可以 | 可以  |

admin 只能管理 viewer 和 editor，不能管理其他 admin；除了所有者本人，谁也动不了所有者。在 Free 套餐里，邀请只能添加 viewer：能分配其他角色，正是付费套餐卖的东西。后面会讲套餐和角色如何保持分开。

## 权限检查放在哪里？

放在领域库里的小纯函数中，一个问题一个函数（[`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)）。最难的那个，谁能改谁的角色，也是最长的：

```ts
export function canManageMember(actor: GroupRole, target: GroupRole, next?: GroupRole): boolean {
  if (!isGroupRole(actor) || !isGroupRole(target) || (next !== undefined && !isGroupRole(next))) {
    return false
  }
  if (actor === GroupRole.OWNER) return true
  if (actor !== GroupRole.ADMIN || target > GroupRole.EDITOR) return false
  return next === undefined || next <= GroupRole.EDITOR
}
```

没有数据库，没有请求，没有框架：单元测试用所有角色组合调用它。处理器读取操作者的角色，在调用仓储之前交给对应的检查：

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

传输层里一条规则都没有。调用无论走 WebSocket 还是 `POST /api/call/<name>`，都会到达同一个处理器，得到同一个答案。正因如此，[实时通信可以回退到 HTTP](/blog/realtime-websocket-with-http-fallback)，而不需要第二套要保持一致的检查。

## 为什么要检查两次角色？

因为写入之前读到的角色，到提交时可能已经过时。设想一下：所有者移除一位编辑的同一瞬间，这位编辑正在保存笔记。处理器一毫秒前读到的是 “editor”，移除操作提交了，笔记却落进了作者已经不属于的群组。

所以每次对群组的写入，都会先在自己的事务里调用 `lockActorRole`（[`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)）：

```ts
const active = await sql`
  SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
`
if (active.length === 0) throw new GroupNotActiveError(groupId)
const member = (await sql`
  SELECT group_members.role
  FROM group_members
  INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
  WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
  FOR SHARE OF group_members
`)[0]
return member?.role ?? null
```

先锁群组那一行，顺序和所有成员变动一致，所以两个操作会互相等待，而不是死锁。成员关系那一行用 `FOR SHARE` 读取：先提交的移除能被看到，后到的移除要等这次写入完成。随后仓储检查拿到的角色，所以第二次检查的代价只是在一个本来就开着的事务里多一次索引读取。

每种笔记写入都有测试证明这一点：测试先把一次移除或降级挂起，启动写入，确认写入在等待，再提交变动，期望写入被拒绝且什么都没保存（`tests/integration/group-write-race.integration.test.ts` 里的 “note update: refused when a removal commits while the write waits”）。

## 为什么外人得到 404 而不是 403？

因为 403 等于告诉对方“这个群组存在，只是不给你”。不是成员的人会收到 `GROUP_NOT_FOUND`，和一个从未存在的群组得到的答案一模一样，所以没人能靠枚举 id 来判断哪些群组是真的。成员缺少所需角色时收到 403 `ROLE_INSUFFICIENT`，因为他本来就知道这个群组存在。

套餐也是同样的思路。群组达到套餐上限时，返回的是 **402 Payment Required** 而不是 403，这样应用能区分“请所有者升级”和“你没有这个角色”。角色决定谁能操作，套餐决定群组能用多少。按席位计费和它的 Webhook 有[单独的一篇文章](/zh-CN/blog/stripe-anrenshu-jifei-webhook)。

## 为什么不用 Postgres 的行级安全？

我考虑过，并把取舍写在了[群组同步设计文档](https://github.com/spy4x/seed/blob/main/docs/design/group-sync.md#9-tradeoffs)里。行级安全会把权限规则的第二份拷贝以 SQL 策略的形式放进数据库，而处理器无论如何都需要一份规则，才能用一个有用的错误回答“你是 viewer”。同一条规则的两份拷贝迟早会不一致。此外，每个数据库连接都得带上当前用户，这会让连接池、后台任务和迁移都变复杂。

坦白说代价也有：过滤写在应用代码里，只要有一条查询忘了 `group_id`，就可能泄露数据。Seed 用三种方式应对：

- **带群组的方法签名。** 仓储方法把群组 id 作为参数，比如 `get(groupId, id)`，查询同时按两者过滤。根本不存在一个会被误用的“按 id 取笔记”。
- **每个功能同一份清单。** [docs/aggregates.md](/zh-CN/docs/aggregates) 列出新功能要照搬的规则：它属于某个群组，每一行都有 `group_id`，每次写入都重新读取角色。
- **跨群组测试。** 集成测试跑在真实的 Postgres 上，并准备一个只在自己群组里的外人，步骤包括 “never counts a note of another group” 和 “a person who is not a member is told the group does not exist”。

如果你的产品需要数据库层面的保证，比如为了合规审计，行级安全是合理的选择，你可以在此基础上再加。作为起步模板，我选择让规则只有一个归宿。

## Seed 不做什么？

- **没有自定义角色。** 只有四个固定角色。需要“账单管理员”的产品，要自己加角色和对应的检查。
- **没有单条记录级别的权限。** 角色作用于整个群组；不能只把一条笔记分享给一个人。
- **没有行级安全**，原因见上文。
- **没有每个租户一套表结构或一个数据库。** 所有群组共用同一批表。

## 动手试试

打开[演示站](https://app.seedsaas.com)，创建一个群组，把第二个账号以 viewer 身份邀请进来，再用它去编辑一条笔记试试。简要介绍在[群组功能页](/zh-CN/features/groups)，而[第一个功能那篇文章](/blog/your-first-feature-copy-the-notes-aggregate)展示了新的记录类型如何靠复制笔记的代码继承这一切。如果你的应用只在事务之前检查一次角色，那我第一个要堵上的就是这个竞态。
