# Telegram bot

Seed ships a Telegram bot that every product extends. A person links their Telegram account from
the app with a one-time code. From then on, every notification they get in the app also reaches
the chat, and the product's own commands answer there, acting as that person. The bot is off
until `TELEGRAM_BOT_TOKEN` is set, and nothing else depends on it.

## Set it up

1. In Telegram, ask [@BotFather](https://t.me/BotFather) for `/newbot`. It gives you the bot's
   username and its token. The token is a secret: put it only in your env file, never in a
   commit, an issue or a log.
2. Set these in `infra/envs/.env.dev` or `.env.prod` (placeholders in `.env.example`):

| Variable                  | What it is                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | The token from BotFather. Unset or empty: the bot is off.                                                                                                       |
| `TELEGRAM_BOT_USERNAME`   | The bot's username without `@`, for the `t.me` link the app opens.                                                                                              |
| `TELEGRAM_WEBHOOK_SECRET` | 32 to 256 of `A-Z a-z 0-9 _ -` (`openssl rand -hex 32`). Required when the API takes the webhook. Telegram sends it with every update; a request without it gets 401. |
| `TELEGRAM_POLLING`        | `true` to poll Telegram for updates, `false` for the webhook. Unset: polling with `ENV=dev`, the webhook elsewhere.                                            |
| `TELEGRAM_API_URL`        | A local Bot API server instead of `https://api.telegram.org`. Usually unset.                                                                                   |

3. Deploy. At start the API sets the bot's command menu and, with the webhook, registers
   `<WEB_APP_URL>/api/webhooks/telegram` with the secret. Either call failing is logged and never
   stops the API.

In development the API polls, because Telegram cannot reach `localhost`. Give your development bot
a token of its own: one token takes updates by polling or by webhook, never both.

## How linking works

- The profile's Notifications section has "Link Telegram". It asks `POST /api/telegram/code` for
  a code, which lasts 10 minutes, works once and replaces the person's previous code.
- "Open Telegram" opens `t.me/<bot>?start=<code>`, so pressing Start sends the code. On another
  device the person sends `/link <code>` instead.
- The bot does not link at once. It names the account the code belongs to (the first name and
  the address masked, such as "Ada's account (a•••@example.com)") and links only after a "Link"
  press by the same Telegram user. A `t.me` link someone else made therefore cannot attach your
  Telegram to their account without you seeing whose it is. The address is always shown, because
  anyone can copy a first name.
- After the press, the bot links the Telegram account to the person, with an audit row, and the
  app closes the dialog. A wrong, used or expired code is refused, and so is a Telegram account
  linked to someone else. Linking a second Telegram account replaces the first, with an unlink
  row for it.
- A code sent in a group is spent without linking, because others in the group could read it.
- `/unlink` in the chat, "Unlink" on the profile (after a confirmation), or an operator's "Unlink
  Telegram" in the admin panel ends it, each with an audit row. A password reset or change ends
  it too, in the same transaction that revokes the API tokens, and deletes every link code and
  waiting "Link" press the person had.
- Guests cannot link: they are asked to keep their account first.

A linked account is an `auth_keys` row with the method `telegram` and the Telegram user id as its
subject. It is no way to sign in. The code is an `auth_challenges` row, as the other one-time
codes are.

## Notifications

`createNotification` queues a `telegram.notification` job in the notification's own transaction,
only for a person with a linked chat. The worker sends the notification's text with an "Open"
button (on an `https` app only). A person who unlinked, was blocked or deleted by then gets
nothing. Telegram refusing the chat (the person blocked the bot) drops the message; any other
failure is retried like every job.

## Add a product's commands

A product edits one file, `apps/api/telegram/commands.ts`. Each command has a name, the
description the command menu shows and a handler that gets the linked person:

```ts
{
  name: `notes`,
  description: `Your newest notes`,
  handler: async (ctx, account) => {
    const notes = await queryBus.execute(new NoteListQuery({ actor: account.actor, ... }))
    await ctx.reply(...)
  },
}
```

- Put `account.actor` on every command and query: the buses check it as for any other client.
- Commands answer in a private chat only. In a group, the bot says so and runs nothing, because
  the answer would show the person's data to everyone there.
- A person who has not linked gets the steps to link instead.
- Button presses go in `callbacks`, by `callback_data` prefix; multi-step talks go in
  `conversations`, kept in Valkey. Both get the linked person the same way.
- Seed's own commands are `/start`, `/link`, `/unlink` and `/help`; a product command with one of
  those names is ignored.

The router, the client, the webhook handler and polling are `@spy4x/integrations/telegram`.
`apps/api/telegram/fake-telegram.ts` is a fake Telegram API for tests.

## Security

- The webhook takes no session. The secret header, compared in constant time before the body is
  read, is its only proof.
- A link code is `<user id>_<binding>_<secret>`, 96 and 144 random bits, at most 52 characters.
  It works once, lasts 10 minutes and counts failed tries. Its challenge is found by the user id
  and the binding together, so someone who knows only a user id cannot use up a person's tries.
  Making a code deletes the person's older ones, needs a full session, second factor included,
  and spends the stricter per-user rate limit.
- A link code and a waiting "Link" press are `auth_challenges` rows whose subject starts with the
  user id: `<user id>:<digest of the binding>` and `<user id>:<Telegram user id>`. A password reset
  or change deletes both, so one prepared with a stolen session cannot link after the owner has
  recovered the account.
- A linked chat acts as its person with the second factor counted as passed, because the session
  that linked it had passed it. Unlike an API token, a chat has no group and no read-only scope:
  it can do anything its person can. So a product must not offer in the bot any command the app
  guards with a fresh password or code, such as changing the address or deleting the account.
- Seed keeps the Telegram user id only: no Telegram name, no messages. The person's data export
  ([data-export.md](data-export.md)) lists it with the time it was linked. A product that turns the
  bot on adds it to its privacy page, for example: "Your Telegram user ID (a number, not your
  phone number), only if you link Telegram. Unlinking removes it." Seed's own demo runs without
  a bot, so its page does not list it.
