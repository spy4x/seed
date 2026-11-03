---
slug: realtime-websocket-with-http-fallback
language: en
title: "Realtime over WebSocket, with HTTP as a fallback"
seoTitle: "WebSocket with HTTP fallback: realtime that still converges"
description: "How Seed sends every call over a WebSocket when one is open and over HTTP when it is not, and why a numbered pull, not the socket, is what keeps every screen correct."
tldr:
  - In Seed, every call is a name and a payload. It goes over the WebSocket when one is open and as `POST /api/call/<name>` when it is not, with the same answer and the same errors.
  - 'The socket only says "something changed", with a change number. The page then pulls everything after the number it holds, so a lost message costs one extra read, never wrong data.'
  - Without a socket, the page pulls on start, when the network returns, when the tab is shown, after its own writes and every 30 seconds while visible.
  - "The rule behind it: delete every line of WebSocket code and the app must still end up correct. Tests run the app exactly that way."
topic: Deep dive
author: Anton Shubin
publishAt: 2026-11-02T22:00:00Z
newsletter: false
---

How do you add realtime over WebSocket without your app breaking when the socket does? In Seed,
the WebSocket makes changes arrive sooner and does nothing else. Every call can also go over
plain HTTP, and correctness lives in one place: a pull of everything after the last change number
the page holds. Lose the socket, and the app gets slower to notice changes, not wrong.

This post is for developers adding realtime to a SaaS who have been bitten by "it works until the
connection drops". It walks through the two decisions behind Seed's transport,
[ADR 002](https://github.com/spy4x/seed/blob/main/docs/decisions/002-realtime-transport-and-sync.md)
and
[ADR 003](https://github.com/spy4x/seed/blob/main/docs/decisions/003-swappable-transport-and-local-data.md),
in plain words.

## What goes wrong with realtime apps?

Before writing those decisions I read how two earlier projects did realtime. One sent every
create, update and delete over the socket, so the app simply stopped working when the socket
was down. The other synced by timestamp, using the device's own clock as "where I got to". A
phone clock a few seconds fast meant changes made inside those seconds were never delivered.
Not late: never. And nothing in any log said so.

Both failures have the same root: they trusted the pushed message as the only way data arrives.
Seed is built so that neither mistake can be written.

## How does one call travel two ways?

A call in Seed is a name and a payload, such as `note.create` with the note's fields. On the
server, one table of operations maps each name to its handler. Two thin adapters read that table:

- the WebSocket at `/api/ws`, which takes a message and dispatches it;
- HTTP at `POST /api/call/<name>`, which takes the same payload as a request body.

Neither adapter holds a business rule. Who may do what is checked in the handler, so both paths
get the same check, the same answer and the same error codes. In the app, the WebSocket is used
while its socket is open, and HTTP takes over while it is not. A write that cannot finish on the
socket is sent again over HTTP with the same idempotency key, so it still runs once.

## What does the socket actually send?

Hints, numbered, with no data in them. Every write to a group bumps that group's change number.
The socket tells the page "group X changed, at number 1843". The page compares that with the
number it holds:

1. **The same number or an older one**: nothing new, so the hint is ignored. A repeated message
   is harmless.
2. **A newer number**: the page pulls everything after its own number, whether the gap is one
   change or fifty.
3. **Only once that pull has succeeded** does the page move its number. A pull that fails leaves
   the number where it was, and the next hint or timer tries again.

The pull is the only path that makes a page correct, and it is the same path that runs with no
socket at all. Dropped frames, reconnects, reordering and duplicates all turn into, at worst, one
extra read. After a reconnect, the page pulls every group it holds, in case it missed a hint while
the socket was down.

## What happens with no socket at all?

The page decides when to pull by itself. It checks for changes:

- when it starts;
- when the browser comes back online;
- when the tab becomes visible again;
- right after its own writes;
- every 30 seconds while the tab is visible.

The 30-second check is cheap: it reads the list of groups, which carries each group's change
number, and reads a group's notes again only when that number has moved. A corporate proxy that
blocks WebSockets, a hotel Wi-Fi that kills idle connections, a server restart: the person sees
changes a little later, and that is all.

## How do you know it really works without the socket?

ADR 002 gives the test in one sentence: **delete every line of WebSocket code and the application
must still converge to correct state.** If a change breaks that, the change is wrong.

That is not left to good intentions. The app reads a switch, `SPA_REALTIME=false`, and with it off
it never opens a socket. End-to-end tests run the app that way and check that notes and tags made
in one browser still show up in another browser's open tab within one poll
(`e2e/realtime-off.e2e.ts` and `e2e/tags-realtime-off.e2e.ts`). Others check what happens
when the socket comes and goes mid-session (`e2e/realtime-resume.e2e.ts`). A guard test,
`tests/realtime-removal.test.ts`, checks that the WebSocket module can really be removed as the
docs say.

## What about security on two paths?

One rule covers both: every call carries the id of the person the page was started for. If the
cookie now belongs to someone else, say another tab signed out and a different person signed in,
both adapters answer `unauthorized` and the page signs itself out. That is also how a page with no
socket learns its session ended. The socket's upgrade request checks the `Origin` header, so
another website cannot open a socket with your cookie.

## Do I need the socket at all?

Maybe not. For many products a 30-second delay is fine, and one less moving part is one less
thing to run. Turn it off with the switch, or delete the module. If you want changes to appear the
moment they happen, keep it. Either way the app stays correct, which is the whole point.

The same layering is what lets Seed work offline: the pull that fixes a lost message also fills
the device's copy. That half of the story is in
[Offline-first with Preact signals](/blog/offline-first-preact-signals-local-database-sync).

## Try it

Open the [live demo](https://app.seedsaas.com) in two browsers, write a note in one and watch it
land in the other. Then block WebSockets in your developer tools and do it again: it still lands,
within 30 seconds. The [realtime feature page](/features/realtime) has the short version, and the
[code](https://github.com/spy4x/seed) has all of it, MIT-licensed.
