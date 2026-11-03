---
slug: passkeys-2fa-sessions-without-auth-saas
language: en
title: "Passkeys, 2FA and sessions without an auth SaaS"
seoTitle: "Passkeys, 2FA and sessions without an auth SaaS"
description: "Can you run passkeys, two-factor codes and revocable sessions yourself, with no auth service to pay? Here is how Seed does it, step by step, with the limits and the code."
tldr:
  - Seed signs people in with a password, a passkey, Google, GitHub or a sign-in link, and adds an authenticator-app code on top. No auth service, no per-user bill.
  - Wrong passwords lock the name for a growing time, and a lock refuses even the right password until it ends.
  - A session is a random token the server stores only as a keyed hash, so a leaked database does not hand out sessions, and signing out works at once.
  - You can list your sessions with their device and end any of them yourself.
topic: Deep dive
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T16:00:00Z
newsletter: false
---

Can you have passkeys, two-factor codes and sessions you can revoke without paying an auth SaaS?
Yes. Seed does all three in its own API, on Postgres and Valkey, with the browser's WebCrypto and
WebAuthn doing the hard maths. There is no outside service in the sign-in path and no bill that
grows with your users.

This post is for developers choosing between "rent auth" and "own auth". I'll walk through each
sign-in as it really happens, step by step, so you can judge what you would be taking on.

## Why not just rent auth?

Renting is a fine choice, and for many teams the right one. My reasons for owning it in Seed were
plain ones: the price climbs exactly when the product starts working, the user table lives in
someone else's database, and the sign-in screen looks like someone else's product. A self-hosted
starter that needs a third-party account to let anyone in is not quite self-hosted.

The cost of owning it is that you must get it right. So here is what "right" means in Seed.

## What happens when you sign in with a password?

1. **You type your name and password.** The page sends them to `POST /api/auth/password/check`.
2. **The server checks the lock first.** Every wrong password for a name counts. The first five
   are free. After that the name is locked for a minute, and each new lock doubles, up to 15
   minutes. While a lock runs, the server does not even look at the password, so guessing during
   a lock gains nothing.
3. **It hashes what you typed.** PBKDF2 with SHA-256, 600,000 rounds, plus a secret pepper kept
   outside the database, all through WebCrypto. A name that does not exist still costs one full
   hash, so the answer takes the same time and does not tell anyone which names are real.
4. **It answers.** Right password and no second factor: you get a session and your profile. Right
   password and an authenticator app turned on: you get a session marked as waiting for its
   second factor, and the answer `202 { "secondFactor": "Pending" }`. That half-finished session
   can do one thing only: finish.

## What happens at the two-factor step?

1. **You type the 6 digits from your authenticator app.** The page sends them to
   `POST /api/auth/totp/check`.
2. **The server checks the code against the current 30-second step**, and one step either side,
   so a phone clock a few seconds off still works.
3. **A code works once.** The step a code belongs to must be later than the last one accepted, so
   a code read over someone's shoulder is dead the moment you have used it.
4. **Wrong codes lock too.** Five free tries, then 15 minutes, doubling up to a day. Seven quiet
   days clear the count.
5. **The session is marked complete**, and only now can it reach the rest of the API.

## What happens with a passkey?

1. **The page asks for a challenge** with `POST /api/auth/passkeys/sign-in/options`. The server
   makes a random one and keeps it in Valkey for this one attempt.
2. **Your device asks for your fingerprint, face or PIN** and signs the challenge with a key that
   never leaves it. The server asks for that check every time ("user verification required").
3. **The page sends the signature** to `POST /api/auth/passkeys/sign-in`. The server takes the
   challenge out of Valkey in one atomic step, so the same signature cannot be replayed, and
   checks it against the public key it stored when you added the passkey. It accepts the two
   common key types, ES256 and RS256, and asks for no attestation, so it does not care which
   brand of device you own.
4. **You are in, with no second factor to type.** A passkey is already something you have plus
   your fingerprint or PIN. The one exception: an account waiting to be deleted, with an
   authenticator app on, still asks for the code before it can be restored.

The WebAuthn checks come from `@simplewebauthn/server`, wrapped in a small module of my shared
library, `@spy4x/server/webauthn`. I would not write signature parsing by hand, and neither
should you.

## What is a session, exactly?

1. **A random token**: 256 bits from a cryptographic random generator. The server stores only a
   keyed hash of it (HMAC-SHA-256 with the pepper). Someone who copies the sessions table gets
   hashes they cannot turn back into tokens.
2. **A cookie**: signed, `HttpOnly`, `SameSite=Lax` and `Secure`, so page scripts cannot read it.
3. **Checked on every request.** There is no long-lived signed ticket that stays valid after you
   sign out. Sign out, and the next request with that cookie is refused, and any live WebSocket
   of that session is closed.
4. **Two months long, renewed while you use it.** "Last used" is written at most every five
   minutes, so busy pages do not hammer the database.
5. **Yours to manage.** Each session records the device name and the IP address with its last
   part hidden. You can see the list and end one session or every other one. Changing your
   password ends your other sessions unless you choose to keep them; resetting it ends all of
   them, deletes your API tokens and removes your push subscriptions.

Every one of those events is written to an audit log in the same database transaction as the
change itself, so the log cannot miss one.

## What else signs people in?

Google, GitHub, sign-in links by email, and guest accounts for trying the product before signing
up. They all end in the same kind of session, with the same list and the same "end it" button.
The full list, and how to switch each on, is in
[the sign-in providers docs](/docs/sign-in-providers).

## What did this cost me?

Honestly, more evenings than renting would have. The lockout and the sign-in flow became shared
libraries (`@spy4x/server/lockout` and `@spy4x/server/sign-in`), so the next product gets them
for free. That is the deal with a starter: someone pays the cost once.

## Try it

Open the [live demo](https://app.seedsaas.com), add a passkey in your profile, sign out and sign
back in with it. Then end the session from another browser and watch the first one lose access on
its next click. Everything is in [the code](https://github.com/spy4x/seed), MIT-licensed, and the
[sign-in feature page](/features/sign-in) has the short version.
