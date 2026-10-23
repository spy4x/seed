# API errors

Every answer of the API that is not a success has one body, on every transport: REST, the calls
route (`/api/call/<name>`) and the socket. A screen translates `reason ?? code`; until it does, it
shows `message`, which stays English.

```json
{
  "error": {
    "code": "bad_request",
    "message": "name must be a string (was number)",
    "reason": "validation",
    "fields": { "name": { "code": "domain" }, "title": { "code": "maxLength", "values": { "rule": 120 } } },
    "requestId": "0195f0b4-3c1e-7a00-8000-0000000000aa"
  }
}
```

| Part        | Always | What it says                                                                        |
| ----------- | ------ | ----------------------------------------------------------------------------------- |
| `code`      | yes    | One of the eight codes below. The status follows from it unless a route says other. |
| `message`   | yes    | One English sentence for API clients, logs and a screen not translated yet.         |
| `reason`    | no     | The feature's finer name for the refusal, such as `GROUP_NOT_FOUND` or `TOO_SOON`.  |
| `fields`    | no     | For a body a schema refused: each failed field's arktype code and rule, by path.    |
| `details`   | no     | JSON a client acts on, such as the plan a refusal names or a file's problems.       |
| `requestId` | no     | The request log's id for this request, to find it in the logs.                      |

Nothing else rides in the body: `apiErrorBodySchema` in `libs/domain/errors` is closed, and the
API tests read every error through it (`apps/api/_testing/api-error.ts`).

## Codes

The codes are the realtime transport's closed list (`REALTIME_ERROR_CODES`), so the socket and REST
never disagree:

| `code`        | Status | Also used for                                            |
| ------------- | ------ | -------------------------------------------------------- |
| `bad_request` | 400    | 413 (body too large), 415, 422 (a file that cannot load) |
| `unauthorized`| 401    |                                                          |
| `forbidden`   | 403    | 402 (a plan refusal)                                     |
| `not_found`   | 404    | 410 (an expired or revoked link)                         |
| `conflict`    | 409    |                                                          |
| `rate_limited`| 429    |                                                          |
| `internal`    | 500    | every other 5xx                                          |
| `timeout`     | 504    | 408                                                      |

A route that keeps an older status, such as 402 for a plan refusal, passes it beside the code.

## Reasons

`ErrorReason` (`libs/domain/errors/+lib.ts`) is the closed union of every feature's error codes
(`NoteErrorCode`, `GroupErrorCode`, `BillingErrorCode` and the rest) plus the API's own few
(`API_ERROR_REASONS`). The compiler refuses a reason that is not on it. A refusal of the shared
middleware (a session guard, the `Origin` check, a rate limit) and an error no route handled have no
reason.

## Fields

`fields` comes from arktype's errors (`fieldErrors` in `@spy4x/validation`), never from its
`.summary`. Each code is arktype's own (`required`, `domain`, `maxLength`, `pattern`,
`predicate`…), and `values` holds only the rule (`rule`, `exclusive`), never the value sent.

## Building one

A route answers with `errorResponse(c, code, { message, reason?, fields?, details?, status? })`
or, for a body a schema refused, `validationResponse(c, errors)`
(`apps/api/services/error-response.ts`). `tests/api-error-shape.test.ts` fails on a route that
builds an error body of its own. The app's `onError` answers an error no route handled as `internal`
with the message `Request failed`, and the log keeps the cause. `libraryRefusals` turns the shared
middleware's `{ error: "…" }` into this body, keeping its status, message and headers.

## Reading one

- `apiFetch` (`@spy4x/platform/api`) gives `error.code`, `error.message`, `error.reason` and
  `error.fields`.
- A client that needs `details` calls `fetch` itself and reads the body with `readApiError`
  (`@domain/errors`), which answers `null` for a body that is not the API's, such as a proxy's.
- On the socket, `RealtimeRequestError` carries `code`, `message`, `reason`, `fields` and `details`.
  `details.code` repeats the reason there, since the library's retry rule reads it.

A REST read hands `error.reason` to `ReadRefused`, so an answer with no reason is taken for the
proxy's, as before ([offline.md](offline.md)).
