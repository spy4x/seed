---
slug: nine-languages-and-right-to-left-from-day-one
language: en
title: "Nine languages and right-to-left from day one"
seoTitle: "SaaS internationalization: nine languages and RTL from day one"
description: "How Seed ships its app, admin panel, website and emails in nine languages, Arabic right-to-left included, and the tests that stop a missing translation or a left-only margin from shipping."
tldr:
  - Seed's app, admin panel, website and emails ship in nine languages, Arabic included, with about 3,900 messages in each.
  - A test fails the build when a message is missing, out of date, or has lost a placeholder. Another fails on a left or right margin that would not flip for Arabic.
  - The language is a setting of the person, stored on the server, and separate from date format, time zone and clock.
  - Adding a tenth language is one list entry, one file per catalog and a few loader lines.
topic: Deep dive
intro: "Seed speaks nine languages from the first commit, Arabic right-to-left included. This post shows how the catalogs stay complete, and the tests that stop a missing translation before it ships."
cover: covers/nine-languages-and-right-to-left-from-day-one.webp
coverAlt: "A violet globe circled by empty speech bubbles, with arrows turning both ways around it."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T20:00:00Z
newsletter: false
---

How do you build a SaaS in several languages, right-to-left included, without it becoming a
rewrite later? Do it from the first screen, and let tests hold the line. Seed ships its app, its
admin panel, its website and its emails in nine languages: English, Russian, Spanish, German,
Brazilian Portuguese, Arabic, French, Japanese and Simplified Chinese. Arabic reads right to left,
and the whole layout turns with it.

This post is for founders and developers who know that "we'll translate later" means "we'll
never translate". I'll show where the words live, what the tests catch, and what right-to-left
really costs.

## Why from day one?

Because adding languages later means touching every screen twice. Every hard-coded string, every
date built by hand, every `margin-left` has to be found and fixed, in code that by then is full of
features. Done from the start, each new screen is translated as it is built, and the cost is a
few minutes per screen instead of a project nobody wants.

There is a plainer reason too. Most people on the internet do not read English first. A product
that speaks their language has a head start over one that does not.

## Where do the words live?

Every word Seed's screens show lives in a catalog, one TypeScript file per area and language:
`i18n/app/de.ts`, `i18n/site/ja.ts` and so on. Five areas: the app, the admin panel, the
website, emails and the API's error messages. English is the source; each other file holds the
same keys.

| Area        | Messages per language |
| ----------- | --------------------: |
| The app     |                 1,503 |
| Admin panel |                 1,487 |
| Website     |                   682 |
| Error codes |                   164 |
| Emails      |                    79 |

That is about 3,900 messages in each language, counted on 2 November 2026. The shared components
from preact-components bring their own catalogs on top.

The app loads only the language you use, as its own small file, so a person reading German does
not download Japanese.

## What stops a translation from going stale?

A test, `i18n/i18n.test.ts`. It fails when:

- a message is missing in any language, or one is left over that English no longer has;
- the English changed after a translation was made (each language keeps a lock file that records
  which English it was translated from);
- a translation lost or misspelled a placeholder such as `{count}`, or a tag around a link;
- a plural is missing a form the language needs. Arabic has six plural forms, Russian four, and
  "1 files" is a bug in any of them;
- an English message is no longer used by any code.

So nobody can ship a button that says `Notes.create` or a German screen that is a week behind the
English one.

## What does right-to-left actually take?

Less than people fear, if the layout never says "left" or "right". Seed's styles use logical
sides: "start" and "end", not "left" and "right". In a left-to-right page start is left; in Arabic
it is right. The browser does the flipping.

A test makes that a rule, not a hope: `tests/spacing.test.ts` walks every app and fails on a
spacing class that names a physical side. The page sets `dir` from the language, the website on
the server and the app the moment you switch.

Two more details that bite late if you skip them:

- **Names inside sentences.** "Anna invited you to the group Team" mixes directions in Arabic, and
  a Latin name can drag the punctuation to the wrong side. User values are wrapped in `<bdi>`, which
  keeps their direction to themselves.
- **Dates, numbers and times.** Every date on every screen goes through one formatter. Another
  test, `tests/no-direct-date-format.test.ts`, fails on any direct `toLocaleString()` call.

## Language, region and clock are three settings

A person's language is saved on the server with their profile, so every device and every email
uses it. The region format, the time zone and the 12- or 24-hour clock are separate settings. An
English speaker living in Germany wants English words and `03.11.2026`. A Russian speaker in
Thailand wants Russian words and Bangkok time. Tying those together is how apps end up showing
the wrong date to half their users.

On the website the language is in the address (`/de/pricing`, `/ar/pricing`), with no redirect
by browser or IP, and every page tells search engines which versions exist.

## Who writes the translations?

AI agents, following a written guide, `i18n/TRANSLATING.md`. It sets the voice per language (`du`
in German, `vous` in French, です/ます in Japanese), a glossary so one thing has one name on every
screen, and the rule to translate the situation, not the words. A second agent reads each new
translation back into English and compares the meaning, and I fix any wording that reads badly.
It is not a professional translation agency, and I won't pretend it is. It is far better than a
screen nobody can read.

## Adding a tenth language

One entry in the list of languages, one catalog file per area, and a few lines in each app that load
it. The tests then list every message the new language still lacks, and stay red until it is
complete.

## Try it

Open the [live demo](https://app.seedsaas.com), go to your profile and switch to Arabic. Watch the
whole app turn around, then switch back. This post exists in all nine languages too, and the
[code](https://github.com/spy4x/seed) is MIT-licensed.
