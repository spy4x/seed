---
slug: stripe-anrenshu-jifei-webhook
language: zh-CN
translationOf: per-seat-billing-stripe-webhooks-retries
title: "用 Stripe 做按人数计费，以及经得起重试的 Webhook"
seoTitle: "Stripe 按人数计费：经得起重复投递的 Webhook 怎么写"
description: "Seed 如何用 Stripe 按成员数向团队收费：席位数通过一个会重试的任务跟随成员名单，每个 Webhook 只生效一次，也绝不会让套餐倒退。"
tldr:
  - "在 Seed 里，Stripe 订阅的数量就是群组的成员数，包括所有者。按比例计费由 Stripe 计算，应用自己不算钱。"
  - "成员先加入，账单随后跟上：worker 任务把新人数告诉 Stripe，Stripe 不可用时用同一个幂等键重试。"
  - "每个事件的 id 和应用它的改动在同一个事务里保存：重复投递什么也不改，失败则一起回滚，让 Stripe 再发一次。"
  - "旧事件永远不会让套餐倒退，每晚的任务会修正任何偏离的席位数。"
topic: 深入解析
intro: "按人数计费看起来只是一个数字：成员数乘以单价。难的是在有人加入、Stripe 宕机、Webhook 重复或乱序到达时，让这个数字一直正确。下面用真实代码讲 Seed 是怎么做的。"
coverAlt: "一排紫色剧院座椅，每张椅子上放着一盆植物，一株新苗正被细绳吊着放进另一张座椅。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

用 Stripe 给 SaaS 做按人数（按席位）计费，怎样才能让账单不和团队的实际人数脱节？在 Seed 里，订阅的数量就是群组的成员数，而且应用不指望靠一次调用或一个 Webhook 来维持它。成员变动先保存；随后一个会重试的任务把新人数告诉 Stripe；每个 Webhook 都按事件 id 记录在应用它的同一个事务里；漏网的情况由每晚的任务兜底。

这篇文章写给正在给 SaaS 加团队计费的开发者，也写给那些 Webhook 处理器一直好好的、直到 Stripe 重发了一次事件才出问题的人。下面的内容都在 MIT 许可的 [Seed 代码](https://github.com/spy4x/seed)里，我引用的是真实代码。

## Seed 里的按人数计费是什么意思？

计费属于群组，也就是 Seed 里的团队。每个群组有一个订阅，由所有者付款。目录里有两个套餐（[`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)）：

| 套餐 | 价格               | 成员       | 试用  |
| ---- | ------------------ | ---------- | ----- |
| Free | 0                  | 最多 3 人  | 无    |
| Pro  | 每位成员每月 €9.00 | 最多 50 人 | 14 天 |

“按成员”指 Stripe 订阅的数量等于群组的成员数，包括所有者。50 人上限用的也是这个数字，所以席位只有一个定义，而不是两个互相矛盾的定义。待接受的邀请不占席位；接受之后才占。

下面按演示站的价格算一算团队要付多少。拖动滑块试试：

<CostCalculator members={5} />

五个人用 Pro，每月 €45。所有者在邀请任何人之前就能看到多一个席位的价格：邀请表单会显示新成员增加的费用，并要求确认。没有这个确认，API 会拒绝邀请（`SEAT_PRICE_NOT_ACCEPTED`），所以即使不用 JavaScript 提交表单，这条规则也成立。

## 为什么成员先加入，再通知 Stripe？

因为 Stripe 慢，不应该妨碍任何人加入团队。最直接的写法是在“接受邀请”的请求里调用 Stripe：如果 Stripe 超时，要么这个人进不来，要么进来了但账单从此一直是错的。两种都不好，而第二种还没人察觉。

Seed 先在单独的事务里保存成员变动。事务提交时会往 outbox 写一行，worker 把每一次变动（加入、被移除、退出）变成一个同步席位的任务。任务在执行时才读取人数，只有和已保存的数量不同时才调用 Stripe（[`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)）：

```ts
const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
if (members < 1 || row.quantity === members) return
const result = await provider.updateQuantity({
  subscriptionId: row.providerSubscriptionId,
  quantity: members,
  // A retry of this row asks for the same count with the same key; a later count gets its own.
  idempotencyKey: `seats:${event.id}:${members}`,
})
if (!result.ok) {
  throw new Error(`seat sync of group ${groupId} failed: ${result.error.code} ...`)
}
```

关键在三个细节：

1. **人数在任务执行时读取**，而不是入队时。一分钟内五个人加入，只需要一次正确的调用，而不是五次互相抢跑。
2. **幂等键包含任务和人数。** 如果 Stripe 已经应用了改动但响应丢了，重试会带上同一个键，Stripe 返回第一次的结果，而不会重复应用。
3. **失败就抛错。** 任务系统按 1 秒、2 秒、4 秒依次加倍重试，间隔最长 15 分钟，共 20 次，大约两个半小时（[jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)）。

改数量时向 Stripe 传 `proration_behavior=create_prorations`，这是 Stripe 的[默认值](https://docs.stripe.com/billing/subscriptions/prorations)：本期剩余部分会加到下一张账单上，或从中扣减。应用从不自己计算按比例的哪怕一欧元。我不写的金额计算，我就不会算错。

## 如果同步一直没成功呢？

两个半小时的重试不等于“永远”，所以还有两条路兜底：

- **Webhook 也会检查。** 当 Stripe 报告的订阅数量和成员数不一致时，保存事件的同一个事务会把一次席位同步放进队列。在有人加入之前打开的结账页面，就是这样自动纠正的。
- **每晚的任务核对所有付费群组。** 每天 03:00，清理任务找出已保存数量与群组人数不符的每个按成员订阅，并为它排一次同步。这覆盖了 Stripe 长时间故障，也覆盖了没有群组事件却人数变了的情况，比如成员删除了自己的账号。

所以席位数会在下一次变动、下一个 Webhook 或下一个夜晚之后恢复正确，看哪个先到。比起只有每次调用都成功才正确的设计，我更喜欢这样。

## 怎样让 Stripe Webhook 经得起重试？

在正式模式下，Stripe 会对投递失败的事件[重试最多三天](https://docs.stripe.com/webhooks#automatic-retries)，还提醒同一个事件可能不止一次送达同一个端点。每次投递都加一个席位或发一封邮件的处理器，迟早会做两遍。

Seed 的 Webhook 按固定顺序做三件事。第一是签名：[`@spy4x/billing`](https://jsr.io/@spy4x/billing) 适配器在解析任何 JSON 之前，用原始请求体校验 `Stripe-Signature` 请求头，容忍窗口为五分钟。签名不对返回 `400`。之后的一切都在一个 Postgres 事务里完成，事务第一步就是记录事件 id（[`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)）：

```ts
return await this.sql.begin(async (transaction) => {
  const stored = await transaction`
    INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (stored.length === 0) return "duplicate"
  // ... apply the subscription, queue mails and seat syncs, record the plan change
})
```

`billing_events.id` 是主键，所以第二次投递什么也插不进去，直接返回，不碰订阅。正因为 id 是在事务**内部**保存的，反过来的情况也安全：如果后面任何一步失败，id 会和其他改动一起回滚，路由返回 `500`，Stripe 的重试就是一次干净的第二次尝试。如果先单独存 id、再应用改动，分成两步，那么只要部署时 API 恰好在两步之间重启一次，这个事件就丢了。

发给所有者的邮件（付款失败、试用即将结束、套餐即将结束）也在同一个事务里放进 outbox，所以重复的事件不会排出第二封邮件。Seed 不处理的事件返回 `200`，Stripe 就不再发送。

## 乱序到达的事件怎么办？

Stripe [不保证事件的顺序](https://docs.stripe.com/webhooks#event-ordering)。一个迟到的、写着 “trialing” 的 `customer.subscription.updated`，不能把之前已经到达的 `active` 改回去。Seed 用一个只会向前走的 upsert 写入订阅：

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

先比事件时间，时间相同时按类型排：创建、更新、删除。更旧的事件匹配不到任何行，什么也不改。同一个 `WHERE` 里的第二条规则，防止一个没在付款的新订阅（比如迟到的扣款失败）顶替正在付款的订阅。

限制我也直说。Stripe 文档建议不要用 `created` 给事件排序，因为它只精确到秒。Seed 只把它当作防倒退的护栏，从不用它判断重复，判断重复靠的是事件 id。同一秒内两个同类事件如果倒序到达，旧的那个仍会被保存下来，直到下一个事件或门户里的一次改动把它纠正。这个情况写在[计费文档](/zh-CN/docs/billing-lifecycle#known-limits)里，修复要等 [spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380)。与其让你自己撞上，不如我先说清楚。

## 测试能证明这些吗？

测试跑在真实的 Postgres 上。Webhook 测试套件（`tests/integration/billing.integration.test.ts`）的 26 个步骤里，有“同一事件的第二次投递什么也不改”和“比已保存事件更旧的事件绝不会让套餐倒退”。席位有自己的测试套件（`tests/integration/seat-billing.integration.test.ts`），步骤包括“被移除的成员和主动退出的成员各让数量减一”和“每晚的任务为每个偏离的群组排一次席位变更”。

## Seed 不做什么？

在基于它开发之前，先了解这些：

- **只有一个付费套餐，按月、按成员。** 没有按用量或计量计费，也没有阶梯价格。新增一个套餐需要 [Plans and limits](/zh-CN/docs/billing-plans) 里的五个步骤。
- **只支持 Stripe。** 代码通过支付服务商接口调用，但目前唯一的适配器是 Stripe。也可以关闭计费，这时每个群组都能用全部功能。
- **`invoice.paid` 和 `invoice.payment_failed` 会被保存，但暂时不改变任何东西。** 套餐跟随订阅本身的状态。
- **钱留在 Stripe。** 应用只保存 Webhook 报告的内容，从不自行决定套餐。

## 动手试试

打开[演示站](https://app.seedsaas.com)，创建一个群组，看看它的“账单”标签页；邀请一个人，发送之前就能看到席位价格。简要介绍在[计费功能页](/zh-CN/features/billing)，从零到真实 Stripe（先用测试模式）的步骤见 [Set up billing](/zh-CN/docs/billing)，群组本身见[群组功能页](/zh-CN/features/groups)。如果你的 Webhook 处理器把保存事件 id 和应用改动分成两步，我今天第一个要改的就是这一行。
