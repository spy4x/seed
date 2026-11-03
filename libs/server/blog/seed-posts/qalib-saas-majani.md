---
slug: qalib-saas-majani
language: ar
translationOf: free-saas-boilerplate
title: هل يوجد قالب SaaS مجاني مفتوح المصدر؟ مقارنة صادقة بين سبعة خيارات
seoTitle: "قالب SaaS مجاني مفتوح المصدر: مقارنة بين 7 قوالب"
description: نعم. Seed وOpen SaaS وNext.js SaaS Starter وixartz وApptension وBoxyHQ وMakerkit Lite مجانية ومفتوحة المصدر. ماذا يقدّم كل منها، ومن يدعم العربية من اليمين إلى اليسار، ومتى تختار أيّها.
tldr:
  - نعم، توجد عدة قوالب SaaS مجانية ومفتوحة المصدر، وأفضلها يأتي بتسجيل الدخول والدفع ولوحة التحكم جاهزة.
  - النسخ المجانية من القوالب المدفوعة كثيرًا ما تحذف الدفع أو الفرق بالذات.
  - قالبان فقط من السبعة فيهما ترجمة عربية باتجاه من اليمين إلى اليسار، Seed وApptension.
  - Stripe متاح في الإمارات، وغير متاح في السعودية ومصر والمغرب. تحقّق من بلد شركتك قبل الاختيار.
topic: أسئلة
author: Anton Shubin
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

نعم، توجد عدة قوالب SaaS مجانية ومفتوحة المصدر (تُسمّى أيضًا boilerplate أو starter kit)، وأفضلها يأتي بتسجيل
الدخول والدفع ولوحة التحكم جاهزة. حتى 3 نوفمبر 2026، تُنشر القوالب Seed وOpen SaaS وNext.js SaaS Starter من Vercel
وixartz SaaS Boilerplate وApptension SaaS Boilerplate وBoxyHQ SaaS Starter Kit وMakerkit Lite برخصة MIT أو
Apache-2.0. الفرق الحقيقي فيما تتركه كل نسخة مجانية خارجها.

أنا مطوّر Seed، فلست طرفًا محايدًا. كل معلومة عن مشروع آخر هنا مرتبطة بالصفحة التي قرأتها فيها يوم 3 نوفمبر 2026،
وحين يناسبك قالب آخر أكثر، أقول ذلك صراحة.

## ما القوالب المجانية المتاحة؟

| القالب                             | الرخصة     | التقنيات                     | الفرق والأدوار                   | الدفع                            | مكان التشغيل                               |
| ---------------------------------- | ---------- | ---------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------ |
| [Seed][seed]                       | MIT        | Deno وHono وPreact وPostgres | مجموعات: مشاهد، محرّر، مشرف، مالك | Stripe، لكل عضو                  | Docker Compose على أي خادم Linux تملكه     |
| [Open SaaS][opensaas]              | MIT        | Wasp: React وNode.js وPrisma | غير مذكورة                       | Stripe أو Polar أو Lemon Squeezy | Fly.io أو Railway بأمر واحد، أو أي استضافة |
| [Next.js SaaS Starter][next]       | MIT        | Next.js وPostgres وDrizzle   | Owner وMember                    | Stripe                           | Vercel حسب دليله                           |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js وDrizzle وClerk      | مؤسسات بأدوار، عبر Clerk         | ليس في النسخة المجانية           | غير محدد                                   |
| [Apptension SaaS Boilerplate][app] | MIT        | React وDjango وPostgres      | مستأجرون: Owner وAdmin وMember   | Stripe                           | AWS عبر AWS CDK                            |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js وPrisma وPostgres    | فرق بأدوار                       | اشتراكات Stripe لكل فريق         | أزرار Vercel وHeroku وDigitalOcean         |
| [Makerkit Lite][mk]                | MIT        | Next.js وSupabase            | ليست في Lite                     | ليس في Lite                      | أي استضافة تشغّل Next.js                    |

«غير مذكورة» تعني أن صفحة المشروع لا تذكرها. هذا لا يثبت غيابها، لكن لا تعتمد عليها.

## أيّها يدعم العربية من اليمين إلى اليسار؟

لمنتج يخدم مستخدمين عربًا، الواجهة العربية ليست تفصيلًا يُؤجَّل: اتجاه الصفحة كله ينقلب، والقوائم والأيقونات
والنماذج معه. فحصتُ ملفات الترجمة في كل مستودع يوم 3 نوفمبر 2026:

- **Seed:** العربية واحدة من تسع لغات في التطبيق ولوحة الإدارة والموقع والرسائل البريدية، والواجهة تنقلب من
  اليمين إلى اليسار. هذه الصفحة نفسها معروضة بهذا الاتجاه.
- **Apptension:** فيه ترجمة عربية مُعلَّمة باتجاه من اليمين إلى اليسار، ضمن ثماني لغات
  ([ملفات الترجمة][app-locales]). إن كان فريقك يكتب بـ Python، فهذا خيار قوي.
- **ixartz:** الإنجليزية والفرنسية فقط ([ملفات الترجمة][ix-locales]).
- **Makerkit Lite وBoxyHQ:** فيهما آلية للترجمة، لكن الإنجليزية وحدها مضمّنة.
- **Open SaaS وNext.js SaaS Starter:** لا تذكر صفحاتهما الترجمة أصلًا.

## هل يعمل الدفع في بلدك؟

معظم القوالب في الجدول تدفع عبر Stripe، وStripe [متاح][stripe-global] في الإمارات، وليس في السعودية ولا مصر ولا
المغرب ولا الأردن ولا قطر (تحققتُ يوم 3 نوفمبر 2026). أمامك ثلاثة طرق:

- **شركة في الإمارات** أو في بلد آخر يدعمه Stripe، وعندها يعمل Seed وغيره كما هو.
- **Open SaaS** الذي يدعم أيضًا Polar وLemon Squeezy، وهما «تاجر مسجَّل» يبيع باسمك ويتولى الضرائب
  ([Polar][polar]، [Lemon Squeezy][lemon]). راجع قائمة الدول لديهما أولًا.
- **بوابة دفع محلية** مكان Stripe. في Seed يتركّز كود الفوترة في وحدة billing الموصوفة في [docs/billing.md][billing]،
  لكن استبدال المزوّد يبقى عمل أيام.

## متى يكون قالب آخر هو الخيار الأفضل؟

- **Open SaaS**: إن كنت تبيع لأفراد وتريد بدائل لـ Stripe. الثمن هو اعتماد إطار Wasp.
- **Next.js SaaS Starter**: إن أردت أساسًا صغيرًا على Next.js تقرؤه في عصر يوم واحد.
- **Apptension**: إن كان فريقك يكتب Python وDjango ويحتاج العربية: تحقق بخطوتين، ومفاتيح المرور، وSSO، وثلاثة
  أدوار، وStripe، ولوحة إدارة.
- **BoxyHQ**: إن كان عملاؤك شركات كبيرة تطلب SAML SSO وSCIM من اليوم الأول. وفيه أيضًا اشتراكات Stripe لكل فريق.

## ماذا يقدّم Seed؟

Seed مصمَّم لمنتج تدفع الفرق مقابله، على خادم تتحكم فيه أنت. في `main` اليوم: الدخول بكلمة مرور، ومفاتيح المرور
(passkeys)، وGoogle وGitHub، ورابط بالبريد، وعامل ثانٍ عبر تطبيق مصادقة، ومجموعات بأربعة أدوار ودعوات، وفوترة Stripe
لكل عضو مع خطة مجانية وتجربة 14 يومًا، ولوحة إدارة على نطاق خاص بها، وتخزين ملفات، وإشعارات داخل التطبيق وعبر Web
Push وTelegram، وتطبيق يفتح دون اتصال.

حدوده بصراحة: Stripe فقط، والخوادم تعمل على Deno 2 (دعم Node وBun [مخطط له][runtime] دون موعد)، ولا يناسب
Serverless، ويصونه شخص واحد، هو أنا.

## من أين أبدأ؟

أجب عن سؤالين: من يدفع لك، فرد أم فريق؟ وبأي وسيلة تستطيع التحصيل من بلدك؟ سيتقلّص الجدول إلى سطر أو سطرين. وإن
كان الجواب «فرق، وStripe متاح لي»، جرّب [العرض الحي](https://app.seedsaas.com) بالعربية، واقرأ
[المقارنة مع القوالب المدفوعة](/ar/compare)، وابدأ من [المستودع][seed].

[seed]: https://github.com/spy4x/seed
[billing]: https://github.com/spy4x/seed/blob/main/docs/billing.md
[runtime]: https://github.com/spy4x/seed/issues/623
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
[stripe-global]: https://stripe.com/global
[app-locales]: https://github.com/apptension/saas-boilerplate/tree/master/packages/webapp-libs/webapp-core/src/translations
[ix-locales]: https://github.com/ixartz/SaaS-Boilerplate/tree/main/src/locales
[polar]: https://polar.sh
[lemon]: https://www.lemonsqueezy.com
