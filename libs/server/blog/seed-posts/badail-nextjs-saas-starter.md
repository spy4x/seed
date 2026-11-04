---
slug: badail-nextjs-saas-starter
language: ar
translationOf: nextjs-saas-starter-alternatives
title: "بدائل Next.js SaaS Starter: ماذا تختار حين يصغر عليك"
seoTitle: "بدائل Next.js SaaS Starter: قوالب مجانية ومدفوعة"
description: Next.js SaaS Starter مجاني وصغير عن قصد، بلا استعادة لكلمة المرور ولا بريد دعوة. بدائل مجانية ومدفوعة فيها هذه الأجزاء جاهزة، مع مصدر كل معلومة.
tldr:
  - Next.js SaaS Starter مجاني بترخيص MIT، فيه فرق بدوري المالك والعضو وStripe Checkout.
  - لا يرسل أي بريد، فالدعوات واستعادة كلمة المرور والتحقق من البريد عليك أنت.
  - المجاني الذي فيه كل ذلك جاهزًا هو Seed؛ والبقاء على Next.js مع أجزاء جاهزة أكثر يعني Makerkit أو Supastarter.
  - احتفظ به إن أردت كودًا صغيرًا لتتعلم منه، أو أن تكتب الدخول بطريقتك.
topic: أسئلة
intro: "Next.js SaaS Starter أساس نظيف وصغير، وملف README الخاص به يقول إنه للتعلّم. هنا ما ينقصه، وأي قالب تختار حين تحتاج هذه الأجزاء جاهزة."
relatedFeature: sign-in
coverAlt: "إطار خشبي صغير حول شتلة واحدة، أمام دفيئة زجاجية مكتملة مليئة بالنباتات البنفسجية."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

Next.js SaaS Starter قالب مجاني بترخيص MIT: دخول بالبريد وكلمة المرور، وStripe Checkout، وفرق بدوري المالك والعضو. يصفه ملف README بأنه صغير عن قصد، مورد للتعلّم. البدائل تفيدك حين تريد أجزاء جاهزة أكثر: Seed مجاني بترخيص MIT، فيه الدعوات واستعادة كلمة المرور ومفاتيح المرور والدفع لكل عضو، وMakerkit وSupastarter مجموعتان مدفوعتان تبقيانك على Next.js.

أنا من يطوّر Seed، فاقرأ وأنت تعرف ذلك. كل معلومة عن منتج آخر مربوطة بمصدرها، وراجعتُها في 4 نوفمبر 2026. وجدت شيئًا قديمًا؟ [افتح issue](https://github.com/spy4x/seed/issues) وسأصحّحه.

## ماذا في Next.js SaaS Starter؟

[Next.js SaaS Starter](https://github.com/nextjs/saas-starter) موجود في مؤسسة Next.js على GitHub، ومعظم الـ commits فيه من Lee Robinson. لديه نحو 16,250 نجمة. يسرد README:

- صفحة هبوط وصفحة أسعار تفتح Stripe Checkout؛
- الدخول بالبريد وكلمة المرور، مع JWT في ملفات تعريف الارتباط؛
- لوحة تحكم فيها فرق وأدوار المالك والعضو؛
- إدارة الاشتراك في Customer Portal الخاص بـ Stripe؛
- سجل نشاط للمستخدمين.

التقنيات: Next.js، وPostgres مع Drizzle، وshadcn/ui. تقرؤه كاملًا في بعد ظهر واحد، وهذا هو المقصود.

## ماذا ينقصه؟

لا يرسل بريدًا. ليس في `package.json` مكتبة بريد، ودعوة عضو تحفظ الدعوة ولا ترسلها؛ والكود يقول ذلك: [`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454). ولا استعادة لكلمة المرور ولا تحقق من البريد في الكود أيضًا.

الدخول بالبريد وكلمة المرور فقط: لا Google ولا GitHub ولا مفاتيح مرور ولا عامل ثانٍ.

الدفع اشتراك واحد لكل فريق. يبدأ Checkout بكمية واحدة وتجربة 14 يومًا، ولا تتغير الكمية إلا إن عدّلها أحد في Customer Portal ([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). إضافة عضو لا تغيّر الفاتورة.

ويتحرك ببطء. آخر تعديلين (commits)، في 8 و11 ديسمبر 2025، كانا تحديثين أمنيين لـ Next.js؛ ثانيهما رفعه إلى Next.js `15.6.0-canary.59` لإصلاح CVE-2025-55182، والذي قبلهما كان في يونيو 2025.

لا شيء من هذا عيب بالنسبة لما يقول القالب إنه هو. المعنى فقط أن ما يحتاجه أولًا فريق يدفع ستكتبه أنت.

## البدائل جنبًا إلى جنب

| الميزة         | Next.js SaaS Starter  | Seed                     | Open SaaS                    | Makerkit                             | Supastarter                         |
| -------------- | --------------------- | ------------------------ | ---------------------------- | ------------------------------------ | ----------------------------------- |
| السعر          | مجاني                 | مجاني                    | مجاني                        | 299 أو 599 دولارًا مرة واحدة          | من 349 إلى 1,499 دولارًا مرة واحدة   |
| الترخيص        | MIT                   | MIT                      | MIT                          | مدفوع؛ مجموعة Lite بترخيص MIT        | مدفوع                               |
| التقنيات       | Next.js وDrizzle      | Hono وPreact؛ Postgres   | Wasp مع React وNode.js       | Next.js 16 أو TanStack Start وغيرهما | Next.js أو Nuxt أو TanStack Start   |
| الفرق والأدوار | المالك والعضو         | من القارئ إلى المالك     | لا                           | نعم، مع دعوات                        | نعم، مع دعوات                       |
| بريد الدعوة    | لا يُرسل               | نعم                      | لا فرق                       | لم أتحقق                             | لم أتحقق                            |
| الدفع          | Stripe، واحد لكل فريق | Stripe، لكل عضو          | Stripe وPolar وLemon Squeezy | لم أتحقق                             | Stripe وLemon Squeezy وثلاثة غيرهما |
| الاستضافة      | Vercel                | Docker Compose على خادمك | Fly.io أو Railway            | لم أتحقق                             | Vercel أو Serverless أو Docker      |

المصادر: [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)، و[Open SaaS](https://github.com/wasp-lang/open-saas)، و[أسعار Makerkit](https://makerkit.dev/pricing)، و[Supastarter](https://supastarter.dev/)، و[README الخاص بـ Seed](https://github.com/spy4x/seed). أسعار Makerkit هي المخفّضة، وأسعاره الأصلية 349 و649 دولارًا. «لم أتحقق» تعني أنني لم أجده في الصفحات التي قرأتها، لا أنه غير موجود.

## أي بديل أختار؟

**تريد البقاء على Next.js مع أجزاء جاهزة أكثر.** ادفع لـ Makerkit أو Supastarter. في كليهما مؤسسات مع دعوات وأدوار؛ وSupastarter يحاسب لكل مقعد ويدعم خمسة مزوّدي دفع. أما Makerkit Lite فمجاني بترخيص MIT، لكن بلا فرق ولا دفع.

**تريده مجانيًا والفرق جاهزة.** هذا هو Seed. لكل حساب مجموعة، بأدوار من القارئ إلى المالك؛ والدعوات تُرسل بالبريد؛ ويحاسب Stripe لكل عضو وتتبع الكمية عدد الأعضاء، مع خطة مجانية وتجربة 14 يومًا ومهلة بعد فشل الدفع. والدخول جاهز أيضًا: كلمة مرور مع رمز تأكيد، ومفاتيح مرور، وGoogle، وGitHub، ورموز دخول بالبريد، وحسابات ضيف، وتطبيق مصادقة كعامل ثانٍ ([الدخول في Seed](/ar/features/sign-in)). أضف تطبيق إدارة بسجل تدقيق، والتحديث الفوري، وتطبيقًا يعمل دون اتصال، وتسع لغات. الثمن: ليس Next.js، بل Hono وPreact.

**تبيع لأفراد ويعجبك أن يتولى الإطار كود الربط.** انظر إلى Open SaaS؛ وكتبتُ أيضًا عن [بدائله](/ar/blog/badail-open-saas).

## كم تكلّف الاستضافة: Vercel أم خادم واحد؟

يقول README القالب أن تنشر على Vercel، ويقبل أي رابط Postgres. أما Seed فيعمل على خادم تستأجره. هنا الاثنان، مع Vercel Pro وSupabase Pro كثنائي مُدار شائع؛ اختر خادمًا وحرّك المؤشر بحسب فريقك:

<HostingCost server="cx23" developers={1} />

مع مطوّر واحد، يكلّف Seed على Hetzner CX23 مبلغ 12.48 يورو شهريًا، والثنائي المُدار 45 دولارًا، أي نحو 40.12 يورو بسعر البنك المركزي الأوروبي في 2 نوفمبر 2026. المقارنة ليست متطابقة: مع الثنائي المُدار لا يحدّث أحد من فريقك خادمًا، وغيرك ينسخ قاعدة البيانات احتياطيًا. الحساب الكامل، مع كل سعر ومصدره، في [نشر SaaS على خادم Hetzner واحد](/blog/deploy-saas-to-one-hetzner-server) (بالإنجليزية).

## متى يبقى Next.js SaaS Starter الخيار الأفضل؟

- تريد تعلّم App Router وServer Actions من كود تقرؤه كاملًا.
- ستكتب الدخول والدفع بطريقتك، وتريد حذف أقل ما يمكن.
- فريقك يعرف Next.js وReact، وتنشر على Vercel.

مخاطر Seed، لتوازن: مشروع حديث بمطوّر واحد يصونه. يعمل الـ API والـ worker أيضًا على Node أو Bun بسطر واحد في ملف env ([عن بيئة التشغيل](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime))، لكن الموقع والأدوات ما زالت تحتاج Deno.

## كيف أجرّب Seed قبل أن أقرر؟

افتح [العرض الحي](https://app.seedsaas.com): نقرة واحدة تدخلك حساب ضيف فيه بيانات نموذجية. ادعُ زميلًا وافتح صفحة الدفع، وهو بالضبط ما يتركه لك قالب Next.js. إن ناسبك، فانسخ [المستودع](https://github.com/spy4x/seed). ولنظرة أوسع، تقارن [بدائل ShipFast](/ar/blog/badail-shipfast) سبعة قوالب في جدول واحد.
