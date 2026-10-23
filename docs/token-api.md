# API reference

A personal API token lets a script or another service work with one of your groups without your
password. The API covers notes for now: list them, read one, and create one.

## Quick start

1. In the app, open **Profile → API tokens** and press **New token**. Pick the group, the access
   and how long it lasts, enter your password and press **Create token**.
2. Copy the token. It is shown once.
3. Find the group's id: open the group in the app. The address reads `/groups/<group-id>/…`, and
   the id is the part right after `/groups/`.
4. List the group's notes:

```sh
export API_TOKEN="<your-token>"
curl -H "Authorization: Bearer $API_TOKEN" \
  "https://app.example.com/api/v1/groups/<group-id>/notes?limit=10"
```

The answer is the first page of notes:

```json
{
  "notes": [
    {
      "id": "01a16904-e753-72b4-aff2-62493acda61b",
      "groupId": "<group-id>",
      "title": "Shopping",
      "body": "Milk, bread",
      "tagIds": [],
      "version": 1,
      "changeSequence": "42",
      "createdByUserId": 7,
      "updatedByUserId": 7,
      "createdAt": "2026-10-23T13:48:11.000Z",
      "updatedAt": "2026-10-23T13:48:11.000Z"
    }
  ],
  "nextCursor": null
}
```

## Keep your token safe

- Treat a token like a password. Keep it in a password manager or your service's secret
  settings, and read it from an environment variable, as the examples do.
- Send it only in the `Authorization` header. Never put it in an address, a query string, code you
  commit, a chat or a support ticket. Nobody from the service will ask you for it.
- If a token leaks, revoke it in **Profile → API tokens**. It stops working at once. Then create a
  new one.

## Your token

- **One group.** A token works in the group you made it for and nowhere else.
- **Access.** _Read only_ can list and read notes. _Read and write_ can also create them.
- **Your role still applies.** A token acts as you, so it can never do more than your role in the
  group allows. A viewer's token cannot create notes, whatever its access.
- **Expiry.** A token lasts 30, 90 or 365 days, or never expires. You choose when you create it.
- **Up to 25 tokens.** Revoke one to create another.
- **Your password.** Creating a token asks for it, so an account with no password cannot create
  one.
- **Only the API.** A token works only under `/api/v1`, and the rest of the app ignores it. It can
  never change your password, e-mail address, sessions or other tokens. A signed-in browser session
  is ignored under `/api/v1`.

## When a token stops working

A token stops working, at once, when:

- it expires;
- you revoke it;
- you change your password, or reset a forgotten one: that revokes every token you have;
- you leave the group, are removed from it, or the group is deleted;
- an operator of the service revokes it, or blocks or deletes your account.

Then create a new token. The app lists only tokens that still work.

## Sending a request

- **Address:** `https://app.example.com/api/v1`, the same host as the app.
- **Token:** the header `Authorization: Bearer <your-token>`. A token starts with `tpl_`.
- **Format:** JSON in and out. Send `Content-Type: application/json` with a body.
- **Ids:** groups, notes and tags have UUIDs. A person's id, such as `createdByUserId`, is a number.

## List notes

`GET /api/v1/groups/{groupId}/notes`

Answers `{ "notes": [...], "nextCursor": "..." }`, a page of the group's notes.

- `limit`: how many notes, 1 to 100.
- `cursor`: pass the previous page's `nextCursor` to get the next page. When `nextCursor` is
  `null`, that was the last page.

```sh
curl -H "Authorization: Bearer $API_TOKEN" \
  "https://app.example.com/api/v1/groups/<group-id>/notes?limit=100&cursor=<next-cursor>"
```

## Get one note

`GET /api/v1/groups/{groupId}/notes/{noteId}`

Answers `{ "note": {...} }`.

```sh
curl -H "Authorization: Bearer $API_TOKEN" \
  "https://app.example.com/api/v1/groups/<group-id>/notes/<note-id>"
```

## Create a note

`POST /api/v1/groups/{groupId}/notes`, with a _Read and write_ token.

The body:

- `id`: the new note's id, a UUID version 7 that you make.
- `title`: up to 200 characters.
- `body`: up to 10,000 characters.
- `tagIds`: optional, up to 20 ids of the group's tags. Ids the group has no tag for are ignored.

Answers `201` with `{ "note": {...} }`.

```sh
curl -X POST \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"<new-uuid-v7>","title":"Shopping","body":"Milk, bread"}' \
  "https://app.example.com/api/v1/groups/<group-id>/notes"
```

**Retrying is safe.** Because you make the id, sending the same create again does not make a
second note: the answer is `200` with the note that exists, as long as nobody has changed it
since. You may also send an `Idempotency-Key`
header, 1 to 128 characters, with a new value for each new note: a retry with the same key gets the
first answer back.

## Too many requests

Each token can make up to 100 requests a minute, and each address up to 100 refused requests a
minute. These are the defaults; the operator of the service may set others.

Past a limit the answer is `429`, in the same body as every other error:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests, please try again later.", "requestId": "..." } }
```

Wait for the number of seconds in the `Retry-After` header, then try again. Every answer also
carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`.

## Errors

Every other error answers with this body:

```json
{ "error": { "code": "unauthorized", "message": "...", "reason": "TOKEN_INVALID", "requestId": "..." } }
```

`code` is one of `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`rate_limited`, `internal` and `timeout`. `reason` names the refusal more finely; these are the
reasons this API answers with. A request whose body does not fit also carries `fields`: each
failed field's path with its code and rule.

- **400** `INVALID_REQUEST`: Something in the request is missing or malformed. Check the ids in the path,
  `limit`, and the JSON body and its lengths against this page.
- **400** `INVALID_CURSOR`: The cursor is not valid. Pass `nextCursor` exactly as you got it.
- **400** `IDEMPOTENCY_KEY_INVALID`: The `Idempotency-Key` header is empty, longer than 128 characters, or
  not plain printable ASCII.
- **401** `TOKEN_INVALID`: The token is missing, revoked or expired. Check the header, or create a new token.
- **402** `PLAN_LIMIT_REACHED`: The group has reached its plan's limit. An owner of the group can change the plan.
- **403** `TOKEN_SCOPE`: The token cannot do that: it is read only, or it was made for another group.
- **403** `ROLE_INSUFFICIENT`: Your role in the group cannot create notes. Ask an owner to make you an editor.
- **404** `GROUP_NOT_FOUND`: No group with this id.
- **404** `NOTE_NOT_FOUND`: No note with this id in this group.
- **409** `ID_ALREADY_EXISTS`: Another note already has this id, or the note was changed after you
  created it. For a new note, make a new UUID version 7.
- **409** `IDEMPOTENCY_IN_PROGRESS`: The first request with this key is still running. Wait a moment, then retry.
- **422** `IDEMPOTENCY_KEY_REUSED`: This key was already used for a different request. Use a new key for each new note.
- **500** `INTERNAL_ERROR`: Something failed on the server. Try again later; if it keeps failing, report the error.

Every error carries a `requestId`. Quote it when you ask for help.

## Not available yet

- Notes cannot be changed or deleted through the API, only listed, read and created.
- The API covers notes only.
- There is no OpenAPI file.
- A token cannot be edited after it is created: revoke it and create a new one.
