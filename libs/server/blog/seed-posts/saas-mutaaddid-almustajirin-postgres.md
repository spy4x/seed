---
slug: saas-mutaaddid-almustajirin-postgres
language: ar
translationOf: multi-tenant-saas-groups-roles-postgres
title: "SaaS متعدد المستأجرين: المجموعات والأدوار وفحص الصلاحيات في Postgres"
seoTitle: "SaaS متعدد المستأجرين في Postgres: المجموعات والأدوار والصلاحيات"
description: "كيف يفصل Seed بين المستأجرين في قاعدة Postgres واحدة: معرّف مجموعة في كل صف، وأربعة أدوار ثابتة، والدور يُفحص في كل معالج ويُقرأ من جديد تحت قفل في كل كتابة."
tldr:
  - "في Seed المستأجر هو المجموعة. كل صف يحمل group_id، ووصول الشخص صفٌّ واحد في group_members بدور من 1 إلى 4."
  - "من يحق له ماذا مجموعة من الدوال الصغيرة النقية. كل معالج يقرأ الدور ويستدعي إحداها، والـWebSocket والـHTTP يتشاركان المعالجات نفسها."
  - "كل كتابة تعيد قراءة الدور داخل معاملتها تحت قفل، فالعضو الذي أُزيل قبل لحظة لا يستطيع تمرير كتابة أخيرة."
  - "لا يوجد row-level security. الغريب يأخذ 404 لا 403، والاختبارات تتحقق من أن مجموعة لا ترى بيانات أخرى أبدًا."
topic: بالتفصيل
intro: "كل منتج SaaS للفرق يجيب عن السؤال نفسه في كل طلب: هل يحق لهذا الشخص أن يلمس هذا الصف؟ هكذا يجيب Seed عنه في قاعدة Postgres واحدة، بالكود الحقيقي، مع الموضع الوحيد الذي يقايض فيه شيئًا من الأمان بالبساطة."
coverAlt: "دفيئة مقسّمة إلى غرف زجاجية، لكل غرفة نباتاتها وبابها البنفسجي، وبجانب كل باب مفتاح معلّق."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: true
---

كيف تبني منتج SaaS متعدد المستأجرين (multi-tenant) على Postgres بحيث لا يرى فريق بيانات فريق آخر
أبدًا؟ في Seed، المستأجر هو **المجموعة**. كل صف يخص مستأجرًا يحمل `group_id`، ووصول الشخص صفٌّ في
`group_members` مع دور، وكل طلب يفحص هذا الدور في الكود قبل أن يقرأ أو يكتب. والكتابة تفحصه مرتين: في
المعالج، ثم مرة أخرى داخل معاملتها تحت قفل. قاعدة بيانات مشتركة واحدة، ومخطط واحد، وبلا row-level
security.

هذا المقال لمن يبني منتجًا للفرق ويريد أن يرى إجابة كاملة تعمل، لا رسمًا تخطيطيًا. كل ذلك موجود في
[كود Seed](https://github.com/spy4x/seed) برخصة MIT، والمقتطفات أدناه أسطر حقيقية مختصرة قليلًا.

## ما المستأجر في Seed؟

المجموعة. لا يوجد نوع «شخصي» منفصل: التسجيل ينشئ مجموعة عادية اسمها «Personal» أنت عضوها الوحيد.
لذلك يمر المستخدم الفرد وفريق من 50 شخصًا عبر الكود نفسه، ولا شيء يحتاج إلى ترحيل حين يدعو أحدهم
زميلًا. ويمكن للشخص أن ينتمي إلى أي عدد من المجموعات.

العضوية جدول واحد
([ملف الترحيل](https://github.com/spy4x/seed/blob/main/libs/server/db/migrations/2026_08_18_0001_group_core.sql)):

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

يحفظ Postgres بنفسه قاعدتين: الدور من 1 إلى 4، وفهرس فريد جزئي يسمح بمالك واحد بالضبط لكل مجموعة. ونقل
الملكية يخفّض المالك القديم قبل أن يرقّي الجديد، في معاملة واحدة، لأن هذا الفهرس لا يقبل مالكين ولو للحظة.
ولكل صف من صفوف الميزة (ملاحظة، وسم، ملف) عمود `group_id` خاص به.

## ما الأدوار الموجودة، وماذا يستطيع كل منها؟

أربعة، ثابتة ومرتبة: viewer (1)، وeditor (2)، وadmin (3)، وowner (4). الترتيب يجعل معظم القواعد مقارنة
واحدة: «editor فما فوق» تعني `role >= 2`.

| ماذا                       | Viewer | Editor | Admin | Owner |
| -------------------------- | ------ | ------ | ----- | ----- |
| قراءة الملاحظات            | نعم    | نعم    | نعم   | نعم   |
| كتابة الملاحظات            | لا     | نعم    | نعم   | نعم   |
| دعوة viewer أو editor      | لا     | لا     | نعم   | نعم   |
| إعادة التسمية ورؤية البريد | لا     | لا     | نعم   | نعم   |
| تعيين admin                | لا     | لا     | لا    | نعم   |
| الدفع والحذف ونقل الملكية  | لا     | لا     | لا    | نعم   |

يدير الـadmin أعضاء viewer وeditor، ولا يدير admin آخر أبدًا، ولا أحد غير المالك يمس المالك. في خطة
Free لا تضيف الدعوة إلا viewer: منح أدوار أخرى هو ما تبيعه الخطة المدفوعة. سأعود لاحقًا إلى كيف تبقى
الخطة منفصلة عن الدور.

## أين يوجد فحص الصلاحيات؟

في دوال صغيرة نقية في مكتبة المجال، دالة لكل سؤال
([`libs/domain/groups`](https://github.com/spy4x/seed/blob/main/libs/domain/groups/+lib.ts)). أصعبها، من
يحق له تغيير دور من، هي الأطول:

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

لا قاعدة بيانات ولا طلب ولا إطار عمل: اختبار وحدة يستدعيها بكل تركيبة من الأدوار. والمعالج يقرأ دور من
يتصرف ويمرره إلى الفحص المناسب قبل أن يستدعي المستودع:

```ts
assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
```

طبقة النقل لا تحمل أي قاعدة. يصل الاستدعاء عبر الـWebSocket أو كـ`POST /api/call/<name>`، وكلاهما يصل
إلى المعالج نفسه ويأخذ الإجابة نفسها. وهذا ما يسمح لـ[الوقت الحقيقي بالرجوع إلى HTTP](/blog/realtime-websocket-with-http-fallback)
دون مجموعة فحوص ثانية يجب إبقاؤها متطابقة.

## لماذا يُفحص الدور مرتين؟

لأن الدور المقروء قبل الكتابة قد يصبح قديمًا عند تأكيدها. تخيّل: المالك يزيل محرّرة في اللحظة نفسها التي
تحفظ فيها ملاحظة. قرأ المعالج «editor» قبل جزء من الثانية، ثم تأكدت الإزالة، فتنتهي الملاحظة في مجموعة لم
تعد كاتبتها عضوًا فيها.

لذلك تستدعي كل كتابة في مجموعة `lockActorRole` أولًا، داخل معاملتها
([`group-change-log.ts`](https://github.com/spy4x/seed/blob/main/libs/server/groups/group-change-log.ts)):

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

يُقفل صف المجموعة أولًا، بالترتيب نفسه الذي يتبعه كل تغيير في الأعضاء، فينتظر كلٌّ منهما الآخر بدل أن
يقعا في deadlock. ويُقرأ صف العضوية بـ`FOR SHARE`: الإزالة التي تأكدت قبله تظهر، والتي تأتي بعده تنتظر
حتى تنتهي الكتابة. ثم يفحص المستودع الدور الذي عاد، فلا يكلّف الفحص الثاني إلا قراءة واحدة بالفهرس داخل
معاملة مفتوحة أصلًا.

يثبت ذلك اختبار لكل نوع من كتابات الملاحظات: يبقي إزالة أو تخفيضًا مفتوحًا، ويبدأ الكتابة، ويرى أنها
تنتظر، ثم يؤكد التغيير ويتوقع رفض الكتابة دون حفظ أي شيء («note update: refused when a removal commits
while the write waits» في `tests/integration/group-write-race.integration.test.ts`).

## لماذا يأخذ الغريب 404 لا 403؟

لأن 403 يقول «هذه المجموعة موجودة، لكنها ليست لك». من ليس عضوًا يأخذ `GROUP_NOT_FOUND`، أي ما تجيب به
مجموعة لم توجد قط، فلا يستطيع أحد تجربة المعرّفات ليعرف أيها حقيقي. أما العضو الذي ينقصه الدور فيأخذ 403
`ROLE_INSUFFICIENT`، لأنه يعرف أصلًا أن المجموعة موجودة.

والخطة تتبع الفكرة نفسها. حين تبلغ المجموعة حد خطتها يكون الرد **402 Payment Required** لا 403، ليميّز
التطبيق بين «اطلب من المالك الترقية» و«ليس لديك الدور». الدور يقرر من يحق له التصرف، والخطة تقرر ما
تحصل عليه المجموعة. ولفوترة المقاعد وwebhooks الخاصة بها
[مقال مستقل](/ar/blog/fawtara-likull-mustakhdim-stripe-webhooks).

## لماذا لا row-level security في Postgres؟

فكرت فيها، وكتبت المفاضلة في
[تصميم مزامنة المجموعات](https://github.com/spy4x/seed/blob/main/docs/archive/group-sync.md#9-tradeoffs).
الـrow-level security تضع نسخة ثانية من قواعد الصلاحيات في قاعدة البيانات، على شكل سياسات SQL، بجانب
النسخة التي تحتاجها المعالجات على أي حال لترد على «أنت viewer» برسالة خطأ مفيدة. ونسختان من قاعدة واحدة
تتباعدان مع الوقت. كما أن كل اتصال سيحمل الشخص الحالي، وهذا يعقّد تجميع الاتصالات والمهام الخلفية
والترحيلات.

الثمن الصريح: مع الفلاتر في كود التطبيق، استعلام واحد ينسى `group_id` قد يسرّب بيانات. ويرد Seed على ذلك
بثلاث طرق:

- **توقيعات تحمل المجموعة.** دالة المستودع تأخذ معرّف المجموعة وسيطًا، مثل `get(groupId, id)`، واستعلامها
  يرشّح بالاثنين. لا توجد دالة «اجلب ملاحظة بالمعرّف» يُساء استخدامها.
- **قائمة قواعد واحدة لكل ميزة.** [docs/aggregates.md](/ar/docs/aggregates) يسرد ما تنسخه الميزة الجديدة:
  تعيش في مجموعة، ولكل صف `group_id`، وكل كتابة تعيد قراءة الدور.
- **اختبارات بين المجموعات.** تعمل اختبارات التكامل على Postgres حقيقي مع غريب في مجموعته الخاصة، بخطوات
  مثل «never counts a note of another group» و«a person who is not a member is told the group does not
  exist».

إن احتاج منتجك ضمانًا على مستوى قاعدة البيانات، لتدقيق امتثال مثلًا، فالـrow-level security خيار سليم
ويمكنك إضافتها فوق ذلك. أما لقالب انطلاق، فاخترت مكانًا واحدًا للقواعد.

## ما الذي لا يفعله Seed؟

- **لا أدوار مخصصة.** أربعة أدوار ثابتة. المنتج الذي يحتاج «مسؤول فوترة» يضيف دورًا وفحوصه.
- **لا صلاحيات لكل سجل.** الدور ينطبق على المجموعة كلها، ولا يمكنك مشاركة ملاحظة واحدة مع شخص واحد.
- **لا row-level security**، كما سبق.
- **لا مخطط ولا قاعدة بيانات لكل مستأجر.** كل المجموعات تتشارك الجداول.

## جرّبه

افتح [النسخة التجريبية](https://app.seedsaas.com)، وأنشئ مجموعة، وادعُ حسابًا ثانيًا بدور viewer، ثم حاول
تعديل ملاحظة منه. الخلاصة في [صفحة المجموعات](/ar/features/groups)،
و[ميزتك الأولى](/blog/your-first-feature-copy-the-notes-aggregate) يبيّن كيف يرث نوع سجل جديد كل هذا بنسخ
كود الملاحظات. إن كان تطبيقك يفحص الدور مرة واحدة قبل المعاملة، فهذا هو السباق الذي كنت سأغلقه أولًا.
