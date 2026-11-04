---
slug: stripe-user-kakin-webhook
language: ja
translationOf: per-seat-billing-stripe-webhooks-retries
title: "Stripeでユーザー数課金を作る：再送に耐えるWebhookの実装"
seoTitle: "Stripeのユーザー数課金と、再送に耐えるWebhookの作り方"
description: "SeedがStripeでチームをメンバー数ぶん課金する仕組みです。席数は再試行されるジョブでメンバー一覧に追従し、Webhookは一度だけ適用され、決して巻き戻りません。"
tldr:
  - "SeedではStripeのサブスクリプション数量がグループのメンバー数（オーナーを含む）です。日割りはStripeが計算し、アプリは金額を計算しません。"
  - "先にメンバーが参加し、請求は後から追いつきます。ワーカーのジョブが新しい人数をStripeに送り、Stripeが落ちている間は同じ冪等キーで再試行します。"
  - "各イベントのIDは、それを適用するのと同じトランザクションで保存されます。再送は何も変えず、失敗すれば両方が取り消されてStripeが再送します。"
  - "古いイベントがプランを巻き戻すことはなく、ずれた席数は夜間ジョブが直します。"
topic: 詳しく
intro: "ユーザー数課金は「人数×単価」という一つの数字に見えます。難しいのは、人が参加し、Stripeが落ち、Webhookが二重に届いたり順番が入れ替わったりする中で、その数字を正しく保つことです。Seedでのやり方を、実際のコードで紹介します。"
coverAlt: "鉢植えの植物が一つずつ置かれた紫色の劇場の座席の列と、もう一つの座席へ糸で下ろされていく新しい苗。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: true
---

Stripeでユーザー数課金（シート課金）を作るとき、請求額をチームの実人数とずらさないにはどうすればよいでしょうか。Seedでは、サブスクリプションの数量はそのままグループのメンバー数です。そしてアプリは、一回のAPI呼び出しや一通のWebhookだけに頼ってその数字を守ろうとはしません。メンバーの変更をまず保存し、再試行されるジョブが新しい人数をStripeに伝え、Webhookはイベントごとに、それを適用するのと同じトランザクションでIDを記録し、取りこぼしは夜間ジョブが拾います。

この記事は、SaaSにチーム課金を入れようとしている開発者と、Stripeの再送が来るまでは問題なく動いていたWebhookハンドラーに泣かされたことのある人のためのものです。内容はすべてMITライセンスの[Seedのコード](https://github.com/spy4x/seed)にあり、実際の行を引用します。

## Seedのユーザー数課金とは？

課金はグループ（Seedでのチーム）に属します。グループごとにサブスクリプションが一つあり、オーナーが支払います。プランは二つです（[`PLANS`](https://github.com/spy4x/seed/blob/main/libs/domain/billing/+lib.ts)）。

| プラン | 料金                     | メンバー | 無料トライアル |
| ------ | ------------------------ | -------- | -------------- |
| Free   | 0                        | 3人まで  | なし           |
| Pro    | メンバー1人あたり月9.00€ | 50人まで | 14日           |

「メンバー1人あたり」とは、Stripeのサブスクリプション数量がオーナーを含むグループのメンバー数だということです。50人の上限が数えるのと同じ数字なので、「席」の定義は一つだけで、食い違う二つの定義はありません。保留中の招待は席を取りません。招待を承諾すると席が一つ増えます。

デモの料金で、チームがいくら払うかを試せます。スライダーを動かしてください。

<CostCalculator members={5} />

Proで5人なら月45€です。オーナーは誰かを招待する前に、席が一つ増えたときの料金を見られます。招待フォームが新しいメンバーで増える金額を表示し、同意を求めます。同意のない招待はAPIが拒否するので（`SEAT_PRICE_NOT_ACCEPTED`）、JavaScriptなしでフォームを送ってもこのルールは守られます。

## なぜStripeより先にメンバーが参加するのか？

Stripeが遅いせいで、誰かがチームに入れなくなってはいけないからです。素直に書くと「招待を承諾する」リクエストの中でStripeを呼びます。Stripeがタイムアウトすれば、その人は参加できないか、参加できても請求がずっと間違ったままになります。どちらも悪く、しかも後者は誰も気づきません。

Seedはまず、メンバーの変更を専用のトランザクションで保存します。そのコミットがoutboxに1行書き込み、ワーカーがすべての変更（参加、削除、退出）を席の同期ジョブに変えます。ジョブは実行した時点の人数を読み、保存済みの数量と違うときだけStripeを呼びます（[`seat-sync.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/seat-sync.ts)）。

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

支えているのは三つの点です。

1. **人数はジョブの実行時に読みます。** キューに入れた時点ではありません。1分間に5人参加しても、必要なのは正しい呼び出し1回で、競い合う5回ではありません。
2. **冪等キーにはジョブと人数が入っています。** Stripeが変更を適用したのに応答が失われた場合、再試行は同じキーを送り、Stripeは二重に適用せず最初の結果を返します。
3. **失敗すると例外を投げます。** ジョブの仕組みが1秒、2秒、4秒…と間隔を延ばし、最大15分間隔で20回、合計およそ2時間半再試行します（[jobs.md](https://github.com/spy4x/seed/blob/main/docs/jobs.md)）。

数量の変更では、Stripeの[デフォルト](https://docs.stripe.com/billing/subscriptions/prorations)である `proration_behavior=create_prorations` を指定します。期間の残りは次の請求書に加算、または差し引かれます。日割りの1ユーロたりとも、アプリが自分で計算することはありません。自分で書かないお金の計算は、自分で間違えようがありません。

## 同期が届かなかったら？

2時間半の再試行は「永遠」ではないので、あと二つの経路で拾います。

- **Webhookでも確認します。** Stripeから届いたサブスクリプションの数量がメンバー数と合わなければ、イベントを保存するのと同じトランザクションが席の同期をキューに入れます。誰かが参加する前に開かれた決済画面は、これで自然に直ります。
- **夜間ジョブがすべての有料グループを照合します。** 毎日03:00のクリーンアップが、保存済みの数量がグループの人数と違うメンバー単位のサブスクリプションを探し、同期をキューに入れます。Stripeの長い障害や、メンバーが自分のアカウントを削除した場合のように、グループの変更なしに人数が変わったケースもこれで拾えます。

つまり席数は、次の変更、次のWebhook、次の夜のうち最も早いタイミングで正しくなります。すべての呼び出しが成功したときだけ正しい設計より、こちらを選びます。

## StripeのWebhookを再送に強くするには？

Stripeは本番モードで、失敗した配信を[最大3日間再送します](https://docs.stripe.com/webhooks#automatic-retries)。また、同じイベントが一つのエンドポイントに複数回届くことがあるとも書いています。配信のたびに席を足したりメールを送ったりするハンドラーは、いつか必ず二重にやります。

SeedのWebhookは決まった順番で三つのことをします。最初は署名です。[`@spy4x/billing`](https://jsr.io/@spy4x/billing) のアダプターが、JSONを1バイトも解析する前に、生のボディに対して `Stripe-Signature` ヘッダーを5分の許容範囲で検証します。署名が不正なら `400` です。その後はすべて、イベントIDの記録から始まる一つのPostgresトランザクションの中で行います（[`postgres-billing-repository.ts`](https://github.com/spy4x/seed/blob/main/libs/server/billing/postgres-billing-repository.ts)）。

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

`billing_events.id` は主キーなので、2回目の配信は何も挿入せず、サブスクリプションに触れずに戻ります。IDをトランザクションの中で保存しているので、逆のケースも安全です。後の処理が失敗すればIDも一緒にロールバックされ、ルートは `500` を返し、Stripeの再送はまっさらな2回目の試行になります。IDを先に保存して後から適用する2段階方式だと、その間にデプロイでAPIが再起動した最初の瞬間にイベントを失います。

オーナー宛てのメール（支払い失敗、トライアル終了間近、プラン終了）も同じトランザクションでoutboxに入れるので、イベントが繰り返されても2通目は送られません。Seedが扱わないイベントには `200` を返し、Stripeは送るのをやめます。

## 順番が入れ替わったイベントは？

Stripeはイベントの[順番を保証しません](https://docs.stripe.com/webhooks#event-ordering)。遅れて届いた「trialing」の `customer.subscription.updated` が、先に届いた `active` を打ち消してはいけません。Seedはサブスクリプションを、前にしか進まないupsertで書き込みます。

```sql
ON CONFLICT (group_id) DO UPDATE SET ...
WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
    <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
```

まずイベントの時刻を比べ、同じなら種類で決めます。作成、更新、削除の順です。古いイベントはどの行にも一致せず、何も変えません。同じ `WHERE` にあるもう一つの条件が、支払いのない新しいサブスクリプション（遅れて届いた決済失敗など）が支払い中のものを置き換えるのを防ぎます。

限界も正直に書きます。Stripeのドキュメントは、`created` は秒単位なのでイベントの順序付けに使わないよう勧めています。Seedはこれを巻き戻し防止にだけ使い、重複の検出には決して使いません。そのためにあるのがイベントIDです。同じ種類のイベントが同じ1秒に逆順で届くと、次のイベントかポータルでの変更が直すまで、古い方が保存されたままになります。このケースは[課金のドキュメント](/ja/docs/billing-lifecycle#known-limits)に書いてあり、修正は[spy4x/ts-libs#380](https://github.com/spy4x/ts-libs/issues/380)待ちです。あなたが自分で見つけるより、先に伝えておきたいのです。

## テストで証明されている？

テストは本物のPostgresで動きます。Webhookのテストスイート（`tests/integration/billing.integration.test.ts`）の26ステップには、「同じイベントの2回目の配信は何も変えない」「保存済みより古いイベントはプランを巻き戻さない」が含まれます。席には専用のスイート（`tests/integration/seat-billing.integration.test.ts`）があり、「削除されたメンバーと退出したメンバーはそれぞれ1つずつ減らす」「夜間ジョブはずれたグループごとに席の変更をキューに入れる」といったステップがあります。

## Seedがしないことは？

使い始める前に知っておいてください。

- **有料プランは一つ、月額、メンバー単位です。** 従量課金や段階料金はありません。プランの追加は[Plans and limits](/ja/docs/billing-plans)の5ステップです。
- **Stripeのみです。** コードは決済プロバイダーのインターフェースを通して話しますが、アダプターはStripeしかありません。課金をオフにもでき、その場合はすべてのグループがすべての機能を使えます。
- **`invoice.paid` と `invoice.payment_failed` は保存しますが、まだ何も変えません。** プランはサブスクリプション自体の状態に従います。
- **お金はStripeに置いたままです。** アプリはWebhookが伝えた内容を保存するだけで、プランを自分で決めることはありません。

## 試してみる

[デモ](https://app.seedsaas.com)を開き、グループを作って「請求」タブを見てください。誰かを招待すると、送る前に席の料金が表示されます。要点は[課金の機能ページ](/ja/features/billing)に、課金なしからテストモードを経て本番のStripeまでの手順は[Set up billing](/ja/docs/billing)に、グループについては[グループのページ](/ja/features/groups)にあります。もしあなたのWebhookハンドラーが、イベントIDの保存と適用を別々のステップで行っているなら、今日まず直すのはその行です。
