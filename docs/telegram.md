# Telegram bot

> Also on the website: [seedsaas.com/docs/telegram](https://seedsaas.com/docs/telegram).

This page sets up the Telegram bot Seed ships, and shows how a product adds its own commands to it.

A person links their Telegram account from the app with a one-time code. From then on, every
notification they get in the app also reaches the chat. The product's commands answer there,
acting as that person. The bot is off until `TELEGRAM_BOT_TOKEN` is set, and nothing else depends
on it.

## Set it up

1. In Telegram, send `/newbot` to [@BotFather](https://t.me/BotFather). It gives you the bot's
   username and its token.
2. Put the token only in your env file: `infra/envs/.env` on your machine, `infra/envs/.env.prod`
   on the server. The token is a secret, so never put it in a commit, an issue or a log.
3. Set the variables below in the same file.
4. For the server, make the webhook secret:

   ```sh
   openssl rand -hex 32
   ```

5. Deploy:

   ```sh
   deno task deploy
   ```

At start, the API sets the bot's command menu. With the webhook, it also registers
`https://<DOMAIN>/api/webhooks/telegram` with the secret. A failing call is logged and never stops
the API.

| Variable                  | What it does                                                       | Default                |
| ------------------------- | ------------------------------------------------------------------ | ---------------------- |
| `TELEGRAM_BOT_TOKEN`      | The token from BotFather. Empty: the bot is off.                   | empty                  |
| `TELEGRAM_BOT_USERNAME`   | The bot's username without `@`, for the `t.me` link the app opens. | empty                  |
| `TELEGRAM_WEBHOOK_SECRET` | 32 to 256 of `A-Z a-z 0-9 _ -`. Required with the webhook.         | empty                  |
| `TELEGRAM_POLLING`        | `true` polls Telegram for updates, `false` takes the webhook.      | polling with `ENV=dev` |
| `TELEGRAM_API_URL`        | A local Bot API server. Usually empty.                             | Telegram's own API     |

Telegram sends the webhook secret with every update, and a request without it gets 401.

In development the API polls, because Telegram cannot reach `localhost`. Give your development bot
a token of its own: one token takes updates by polling or by webhook, never both.

## How a person links

1. On the profile's Notifications section, the person presses "Link Telegram". The app gets a code
   that lasts 10 minutes and works once.
2. "Open Telegram" opens `t.me/<bot>?start=<code>`, so pressing Start sends the code. On another
   device, the person sends `/link <code>` instead.
3. The bot names the account the code belongs to, such as "Ada's account (a•••@example.com)".
4. The person presses "Link". The bot links the accounts, writes an audit row, and the app closes
   its dialog.

The bot links only after a "Link" press by the same Telegram user. So a `t.me` link someone else
made cannot attach your Telegram to their account without you seeing whose it is. The masked
address is always shown, because anyone can copy a first name.

What else to know:

- A wrong, used or expired code is refused, and so is a Telegram account linked to someone else.
- A new code replaces the person's previous one. Linking a second Telegram account replaces the
  first, with an unlink audit row for it.
- Every press takes the "Link" button off its message. A stale button gets its own answer and
  links nothing.
- A code sent in a group chat is spent without linking, because others in the group could read it.
- Guests cannot link: they are asked to keep their account first ([guests.md](guests.md)).
- The bot answers in the language Telegram reports for the person, when the app offers it, else in
  English. Its words are the `TelegramBot.*` keys of the `app` catalog.

A link ends with `/unlink` in the chat, "Unlink" on the profile, or "Unlink Telegram" in the admin
panel. Each writes an audit row. A password reset or change ends it too, and deletes every waiting
code and "Link" press of the person.

A linked account cannot sign in: it only receives notifications and runs commands.

## Notifications

Every notification of a person with a linked chat goes to the chat too. The message has an "Open"
button when the app runs on `https`. A person who unlinked, was blocked or was deleted by then gets
nothing. When the person blocked the bot, the message is dropped; any other failure is retried
like every job.

## Add a product's commands

A product edits one file, `apps/api/telegram/commands.ts`. Each command has a name, the description
the command menu shows, and a handler that gets the linked person:

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

- Put `account.actor` on every command and query. The buses check it as for any other client.
- Commands answer in a private chat only. In a group, the bot says so and runs nothing, because
  the answer would show the person's data to everyone there.
- A person who has not linked gets the steps to link instead.
- Button presses go in `callbacks`, by `callback_data` prefix. Multi-step talks go in
  `conversations`, kept in Valkey. Both get the linked person the same way.
- Seed's own commands are `/start`, `/link`, `/unlink` and `/help`. A product command with one of
  those names is ignored.

`apps/api/telegram/fake-telegram.ts` is a fake Telegram API for tests. The router, the client and
the webhook handling come from `@spy4x/integrations/telegram`.

## Security

- The webhook takes no session. The secret header is its only proof, compared in constant time
  before the body is read.
- A link code is `<user id>_<binding>_<secret>`: a random binding of 96 bits that finds it, and a
  random secret of 144 bits. It works once, lasts 10 minutes and counts failed tries.
- The code is found by the user id and the binding together. So knowing a person's user id is not
  enough to use up their tries.
- Making a code needs a full session, second factor included, and spends the stricter per-user
  rate limit.
- A password reset or change deletes waiting codes and presses. So one prepared with a stolen
  session cannot link after the owner has recovered the account.
- A linked chat acts as its person, with the second factor counted as passed. Unlike an API token,
  it has no group and no read-only scope.
- So a product must not offer in the bot any command the app guards with a fresh password or code,
  such as changing the address or deleting the account.

## Privacy

Seed keeps the Telegram user id only: no Telegram name and no messages. The person's data export
([data-export.md](data-export.md)) lists it with the time it was linked.

A product that turns the bot on adds it to its privacy page, for example: "Your Telegram user ID (a
number, not your phone number), only if you link Telegram. Unlinking removes it." Seed's own demo
runs without a bot, so its page does not list it.

## Next

- [Background jobs](jobs.md): how notifications reach the chat and are retried.
- [Data export](data-export.md): where the linked account shows up.
