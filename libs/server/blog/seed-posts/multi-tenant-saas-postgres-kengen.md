---
slug: multi-tenant-saas-postgres-kengen
language: ja
translationOf: multi-tenant-saas-groups-roles-postgres
title: "マルチテナントSaaSの作り方：Postgresでのグループ、ロール、権限チェック"
seoTitle: "マルチテナントSaaSをPostgresで：グループ、ロール、権限チェック"
description: "Seedが一つのPostgresデータベースでテナントを分ける方法です。すべての行にグループID、固定の4ロール、ハンドラーごとのロール確認、そして書き込みのたびにロックしてロールを読み直します。"
tldr:
  - "Seedのテナントはグループです。すべての行がgroup_idを持ち、人のアクセス権はgroup_membersの1行（ロールは1〜4）です。"
  - "誰が何をできるかは、小さな純粋関数の集まりです。各ハンドラーがロールを読んで関数を呼びます。WebSocketとHTTPは同じハンドラーを使います。"
  - "書き込みのたびに、自分のトランザクション内でロックを取ってロールを読み直します。直前に外されたメンバーが最後の1回を書き込むことはできません。"
  - "row-level securityは使いません。部外者には403ではなく404を返し、あるグループが別のグループのデータを見られないことをテストで確かめます。"
topic: 詳しく
intro: "チーム向けのSaaSは、どのリクエストでも同じ問いに答えます。この人はこの行に触れてよいのか。Seedが一つのPostgresデータベースでどう答えているかを、実際のコードと、安全性より単純さを選んだ唯一の箇所も含めて紹介します。"
coverAlt: "ガラスの部屋に仕切られた温室。部屋ごとに植物と紫色の扉があり、扉の横には鍵が掛かっています。"
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

あるチームが別のチームのデータを決して見られないように、PostgresでマルチテナントのSaaSを作るにはどうすればよいでしょうか。Seedでは、テナントは**グループ**です。テナントに属するすべての行が `group_id` を持ち、人のアクセス権は `group_members` の1行とそのロールで、すべてのリクエストは読み書きの前にコードでロールを確認します。書き込みは2回確認します。ハンドラーで1回、そして書き込み自身のトランザクションの中で、ロックを取ってもう1回です。データベースは共有の一つ、スキーマも一つで、row-level securityは使いません。

この記事は、チーム向けの製品を作っていて、図ではなく実際に動く答えの全体を見たい開発者のためのものです。すべてMITライセンスの[Seedのコード](https://github.com/spy4x/seed)にあり、以下の抜粋は実際の行を少し削ったものです。

## Seedでのテナントとは？

グループです。「個人用」という別の種類はありません。サインアップすると、あなただけがメンバーの「Personal」という普通のグループが作られます。だから一人のユーザーも50人のチームも同じコードを通り、誰かが同僚を招待したときに移行するものは何もありません。一人がいくつのグループに入ってもかまいません。

メンバーシップは一つのテーブルです（[マイグレーション](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)）。

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

二つのルールはPostgres自身が守ります。ロールは1から4であること、そして部分ユニークインデックスにより、オーナーはグループに必ず1人だけであることです。オーナーの移譲は、一つのトランザクションの中で、新しいオーナーを昇格させる前に旧オーナーを降格させます。このインデックスは一瞬でもオーナーが2人になることを許さないからです。機能ごとの行（メモ、タグ、ファイル）もそれぞれ `group_id` 列を持ちます。

## ロールは何があり、それぞれ何ができる？

固定で順序のある4つです。viewer（1）、editor（2）、admin（3）、owner（4）。順序があるので、ほとんどのルールは比較一つで書けます。「editor以上」は `role >= 2` です。

| できること                               | Viewer | Editor | Admin | Owner |
| ---------------------------------------- | ------ | ------ | ----- | ----- |
| グループのメモを読む                     | ○      | ○      | ○     | ○     |
| メモを作成、編集、削除する               | ×      | ○      | ○     | ○     |
| viewerまたはeditorとして招待する         | ×      | ×      | ○     | ○     |
| グループ名の変更、メンバーのメールの閲覧 | ×      | ×      | ○     | ○     |
| 誰かをadminにする                        | ×      | ×      | ×     | ○     |
| 支払い、グループの削除、オーナーの移譲   | ×      | ×      | ×     | ○     |

adminが管理できるのはviewerとeditorだけで、ほかのadminは管理できません。オーナーに手を出せるのはオーナー本人だけです。Freeプランでは、招待で追加できるのはviewerだけです。ほかのロールを付けられることが有料プランの価値です。プランとロールをどう分けているかは後で説明します。

## 権限チェックはどこにある？

ドメインライブラリの小さな純粋関数にあります。問いごとに一つです（[`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)）。いちばん難しい「誰が誰のロールを変えられるか」が、いちばん長い関数です。

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

データベースもリクエストもフレームワークもありません。ユニットテストが、ロールのすべての組み合わせでこの関数を呼びます。ハンドラーは操作する人のロールを読み、リポジトリを呼ぶ前に該当するチェックに渡します。

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

トランスポート層にはルールが一つもありません。呼び出しはWebSocketでも `POST /api/call/<name>` でも同じハンドラーに届き、同じ答えを受け取ります。だから[リアルタイム通信がHTTPにフォールバック](/blog/realtime-websocket-with-http-fallback)しても、同期を保つべき2組目のチェックは要りません。

## なぜロールを2回確認するのか？

書き込み前に読んだロールは、コミットの時点で古くなっていることがあるからです。オーナーがeditorを外したまさにその瞬間に、そのeditorがメモを保存したとします。ハンドラーは1ミリ秒前に「editor」と読み、削除がコミットされ、メモは作者がもう属していないグループに入ってしまいます。

そこで、グループへの書き込みはすべて、自分のトランザクションの中で最初に `lockActorRole` を呼びます（[`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)）。

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

グループの行を先にロックします。メンバーを変更するすべての処理と同じ順番なので、二つの処理はデッドロックにならず、互いを待ちます。メンバーシップの行は `FOR SHARE` で読みます。先にコミットされた削除は見え、後から来た削除はこの書き込みが終わるまで待ちます。その後リポジトリが返ってきたロールを確認するので、2回目のチェックのコストは、どのみち開いているトランザクション内でのインデックス読み取り1回です。

メモの書き込みの種類ごとに、これを証明するテストがあります。削除や降格を開いたまま書き込みを始め、書き込みが待つことを確認し、変更をコミットして、何も保存されずに書き込みが拒否されることを確かめます（`tests/integration/group-write-race.integration.test.ts` の「note update: refused when a removal commits while the write waits」）。

## なぜ部外者には403ではなく404なのか？

403は「このグループは存在するが、あなたには見せない」と伝えてしまうからです。メンバーでない人には `GROUP_NOT_FOUND` を返します。存在しないグループと全く同じ答えなので、IDを総当たりして本物のグループを探ることはできません。必要なロールがないメンバーには403の `ROLE_INSUFFICIENT` を返します。その人はグループがあることをもう知っているからです。

プランも同じ考え方です。グループがプランの上限に達したときは403ではなく **402 Payment Required** を返します。アプリが「オーナーにアップグレードを頼んでください」と「ロールが足りません」を区別できるようにするためです。ロールは誰が操作できるかを、プランはグループが何をどれだけ使えるかを決めます。席単位の課金とそのWebhookは[別の記事](/ja/blog/stripe-user-kakin-webhook)で詳しく書いています。

## なぜPostgresのrow-level securityを使わないのか？

検討はしました。そのトレードオフは[グループ同期の設計](https://github.com/spy4x/seed/blob/main/docs/archive/group-sync.md#9-tradeoffs)に書いてあります。row-level securityを使うと、権限ルールの2つ目のコピーがSQLポリシーとしてデータベースに置かれます。ハンドラー側にも「あなたはviewerです」とわかりやすいエラーを返すためのコピーがどのみち必要なので、同じルールが2か所にできます。2つのコピーはいずれずれます。さらに、すべての接続が現在のユーザーを持ち回る必要があり、コネクションプール、バックグラウンドジョブ、マイグレーションが複雑になります。

正直なコストもあります。アプリのコードでフィルターする以上、`group_id` を忘れたクエリが一つあればデータが漏れえます。Seedはこれに三つの方法で備えています。

- **グループ付きのシグネチャ。** リポジトリのメソッドは `get(groupId, id)` のようにグループIDを引数に取り、クエリは両方で絞り込みます。誤用できる「IDでメモを取得」はそもそもありません。
- **すべての機能に同じチェックリスト。** [docs/aggregates.md](/ja/docs/aggregates) が新しい機能の守るルールを並べています。グループの中に置く、すべての行に `group_id`、すべての書き込みでロールを読み直す、です。
- **グループをまたぐテスト。** 統合テストは本物のPostgresで、自分のグループを持つ部外者を用意して動きます。「never counts a note of another group」「a person who is not a member is told the group does not exist」といったステップです。

コンプライアンス監査などでデータベース側の保証が必要な製品なら、row-level securityは妥当な選択で、上に重ねて追加できます。スターターとしては、ルールの置き場所を一つにすることを選びました。

## Seedがしないことは？

- **独自ロールはありません。** ロールは固定の4つです。「課金担当」が必要な製品は、ロールとそのチェックを追加します。
- **レコード単位の権限はありません。** ロールはグループ全体に効きます。1件のメモを1人だけに共有することはできません。
- **row-level securityはありません。** 理由は上のとおりです。
- **テナントごとのスキーマやデータベースはありません。** すべてのグループがテーブルを共有します。

## 試してみる

[デモ](https://app.seedsaas.com)を開いてグループを作り、2つ目のアカウントをviewerとして招待し、そのアカウントからメモを編集してみてください。要点は[グループの機能ページ](/ja/features/groups)に、新しい種類のレコードがメモのコードをコピーするだけでこれをすべて受け継ぐ様子は[最初の機能の記事](/blog/your-first-feature-copy-the-notes-aggregate)にあります。あなたのアプリがトランザクションの前に一度だけロールを確認しているなら、私が最初に塞ぐのはその競合です。
