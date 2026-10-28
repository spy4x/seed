# API errors

Every answer of the API that is not a success has one body, on every transport: REST, the calls
route (`/api/call/<name>`) and the socket. The apps word it in the person's language from the
`errors` catalog (`errorText` in `libs/ui/message.ts`): the first failed field, else the reason,
else the code. In English, a refusal with no field and no known reason shows `message` instead,
which often says more than its code.

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
| `fields`    | no     | Each failed field's code and rule, by path: from a schema or a feature's own check. |
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

`fields` has two sources. A body a schema refused gives arktype's errors (`fieldErrors` in
`@spy4x/validation`), never its `.summary`, with arktype's own codes (`required`, `domain`,
`maxLength`, `pattern`, `predicate`…). A feature's own check, carried by its domain error, adds
codes of its own, such as `unsafeCharacters`, `hexColor`, `slug`, `httpsUrl` and `range`; the
`errors` catalog (`i18n/errors/en.json`, `Field.*`) has a sentence for each. `values` holds the
rule (`rule`, `exclusive`, or `min` and `max` for a range), and for `unknownLanguage` the language
tag the request sent.

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
