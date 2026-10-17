# Seed: design brief

What every screen of Seed is for and how it should feel. The house style (type, spacing, shell,
components) is preact-components' `docs/design-language.md`; this page says only what is Seed's
own.

## Who it is for

- **The builder**: a developer or a small team that starts a web product from Seed instead of
  spending its first weeks on sign-in, teams, billing and an admin area. They read the code, run the
  live demo and judge Seed by how finished it feels.
- **The builder's users**: people who sign up to the product built on Seed and work in it together
  in groups. They never hear the name Seed; the product they use carries its own name.
- **The operator**: the founder or support person of that product, in the admin panel, answering
  "who is this person, what happened, and what can I do about it".

## Its job

Seed is the groundwork of a SaaS, already built and tested: sign-in with a second factor, groups
with roles and invitations, per-member Stripe billing, realtime, an app that works offline, a
public website and an admin panel. It is free and MIT-licensed, and it deploys to one server the
builder owns with Docker Compose. Every screen is a working example a builder keeps, so each one
must be good enough to ship as it is.

## Voice

- Plain, calm and exact. Say what happened and what to do next; no "Oops", no exclamation marks, no
  jokes in errors.
- Honest about limits. When something is not built, or a number comes from a source with gaps,
  the screen says so in one line.
- Sentence case, digits for numbers, one wording per action across the app.
- To the builder (website, docs) Seed speaks as one developer to another: what it does and what
  it costs them to adopt. Inside the app it stays out of the way and speaks about the user's work,
  not about Seed.

## Brand

- Hue: purple, 305°. Light accent `oklch(0.381 0.176 305)` (`#59168b`), set as `--color-primary`
  and `--color-accent`. Dark mode is the house ink palette with the same hue.
- The brand mark is the house construction: a rounded square in the brand hue with a white glyph,
  then "Seed" in Geist 500. It appears on the public website and the signed-out screens; a
  signed-in page carries no brand, because the frame is the library's `AppShell`, the same in every
  app of the house.
- The admin panel is told apart by a neutral gray "Admin" badge, never by a second accent: under
  the operator's avatar in the rail, beside "Seed" on its sign-in page, and in its page titles
  ("Users · Admin · Seed").
- The accent marks the one primary action and "current". Status colours are never purple.

## Reference products

- **Linear**: restraint, one accent, near-black dark mode, keyboard first.
- **Stripe Dashboard**: tables and money that respect the reader, a detail page per record with
  its history, errors that say what to do. The bar for the admin panel.
- **Plausible**: an open-source product with honest copy and a page a reader can skim in a
  minute. The bar for the public website's tone.
