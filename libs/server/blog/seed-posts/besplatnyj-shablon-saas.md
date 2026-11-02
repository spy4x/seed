---
slug: besplatnyj-shablon-saas
language: ru
translationOf: free-saas-boilerplate
title: Есть ли бесплатный шаблон SaaS с открытым кодом? Семь вариантов и честное сравнение
seoTitle: "Бесплатный шаблон SaaS: 7 open-source стартеров"
description: Да, есть. Seed, Open SaaS, Next.js SaaS Starter, ixartz, Apptension, BoxyHQ и Makerkit Lite бесплатны и открыты. Что в каждом есть и что делать с оплатой из России.
tldr:
  - Бесплатных SaaS-шаблонов с открытым кодом несколько, и в хороших уже есть вход, оплата и панель управления.
  - В бесплатных версиях платных китов часто нет оплаты или команд.
  - Stripe не работает с российскими компаниями, поэтому оплату через ЮKassa или CloudPayments придётся подключать самим, в любом из этих шаблонов.
  - Seed даёт группы с ролями, оплату за участника, админку и девять языков на вашем собственном сервере.
topic: Вопросы
author: Anton Shubin
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Да, бесплатные SaaS-шаблоны (их ещё называют boilerplate или стартер) с открытым кодом есть, и
приличные из них уже умеют вход, оплату и панель управления. На 3 ноября 2026 года под лицензиями
MIT или Apache-2.0 доступны Seed, Open SaaS, Next.js SaaS Starter от Vercel, ixartz SaaS
Boilerplate, Apptension SaaS Boilerplate, BoxyHQ SaaS Starter Kit и Makerkit Lite. Разница в том,
что именно каждый оставил за бортом.

Seed делаю я, так что я заинтересованная сторона. Каждый факт о чужом проекте ниже ведёт на
страницу, где я его прочитал 3 ноября 2026 года. Где другой шаблон подходит вам лучше, так и пишу.

## Какие бесплатные шаблоны SaaS существуют?

| Шаблон                             | Лицензия   | Стек                         | Команды и роли                             | Оплата                          | Где запускается                                      |
| ---------------------------------- | ---------- | ---------------------------- | ------------------------------------------ | ------------------------------- | ---------------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres | Группы: зритель, редактор, админ, владелец | Stripe, за каждого участника    | Docker Compose на любом вашем Linux-сервере          |
| [Open SaaS][opensaas]              | MIT        | Wasp: React, Node.js, Prisma | Не указаны                                 | Stripe, Polar или Lemon Squeezy | Fly.io или Railway одной командой, или любой хостинг |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle   | Owner и Member                             | Stripe                          | Vercel, по его инструкции                            |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk      | Организации с ролями, через Clerk          | Нет в бесплатной версии         | Не указано                                           |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres      | Тенанты: Owner, Admin, Member              | Stripe                          | AWS, через AWS CDK                                   |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres    | Команды с ролями                           | Stripe, подписка на команду     | Кнопки Vercel, Heroku, DigitalOcean                  |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase            | Нет в Lite                                 | Нет в Lite                      | Любой хостинг с Next.js                              |

«Не указаны» значит, что на странице проекта об этом не сказано. Не доказательство, что функции нет,
но и рассчитывать на неё не стоит.

## А как принимать оплату из России?

Это главный вопрос, который англоязычные обзоры пропускают. Россия не входит в
[список стран Stripe][stripe-global] (проверено 3 ноября 2026), а у Lemon Squeezy и Polar свои
списки стран, их стоит проверить отдельно. Из коробки шаблоны из таблицы рассчитаны на эти
провайдеры, и Seed тоже: в нём только Stripe.

Что остаётся:

- **Компания за рубежом.** Если у вас есть юрлицо в стране из списка Stripe, Seed и остальные
  работают как есть.
- **Свой платёжный модуль.** ЮKassa, CloudPayments или Т-Касса подключаются вместо Stripe. В Seed
  код оплаты живёт в основном в модуле billing, а как он устроен, описано в
  [docs/billing.md][billing]. Это облегчает замену, но всё равно это работа на дни, не на минуты.

Второй российский нюанс: персональные данные пользователей из России по 152-ФЗ должны сначала
попадать в базу на территории России ([обзор требований, ComNews, 13.10.2025][localization]). Тут
выигрывают шаблоны, которые работают на любом своём сервере: Seed, Open SaaS при ручном деплое,
BoxyHQ через Docker. С Clerk у ixartz аккаунты пользователей хранит сторонний сервис, и это стоит
обсудить с юристом заранее.

## Когда лучше взять не Seed?

- **Open SaaS**, если продаёте отдельным людям и хотите выбор между Stripe, Polar и Lemon Squeezy.
  Только придётся полюбить фреймворк Wasp.
- **Next.js SaaS Starter**, если нужен маленький понятный каркас на Next.js, а остальное вы
  напишете сами.
- **Apptension**, если команда пишет на Python и Django: там вход с вторым фактором, passkeys,
  SSO, тенанты с тремя ролями и админка.
- **BoxyHQ**, если продаёте корпорациям, которым с первого дня нужны SAML SSO и SCIM.
  Подписки Stripe на команду там тоже есть.
- **Ничего из этого**, если модель входа, мультитенантности или оплаты у вас совсем необычная.

## Что даёт Seed?

Seed рассчитан на продукт, за который платят команды, на сервере, который контролируете вы. В
`main` уже есть: вход по паролю, passkeys, Google, GitHub и ссылкой на почту, второй фактор через
приложение-аутентификатор, группы с четырьмя ролями и приглашениями, оплата Stripe за каждого
участника с бесплатным планом и 14-дневным пробным периодом, админка на отдельном домене,
хранилище файлов, уведомления в приложении, через web push и в Telegram, офлайн-режим и девять
языков интерфейса, включая русский.

Честно о минусах: только Stripe, сервер на Deno 2 (поддержка Node и Bun
[в планах][runtime], без даты), нужен свой сервер, а не serverless, и мейнтейнер пока один, это я.

## С чего начать?

Ответьте себе на два вопроса: кто вам платит, один человек или команда, и через какого провайдера
вы сможете принимать деньги. Это сразу сужает таблицу до одного-двух вариантов. Если ответ
«команды и свой сервер», откройте [демо](https://app.seedsaas.com) (интерфейс переключается на
русский) и [сравнение с платными шаблонами](/ru/compare), а потом заберите [репозиторий][seed].

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
[localization]: https://www.comnews.ru/digital-economy/content/241730/2025-10-13/2025-w42/1016/granica-zamke-osobennosti-raboty-personalnymi-dannymi-rossii
