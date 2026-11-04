# API errors

> Also on the website: [seedsaas.com/docs/api-errors](https://seedsaas.com/docs/api-errors).

This page describes the one error body the API sends, and how to build and read it.

You need:

- A route or a client of the API. Every transport answers a failure with this body: REST, the
  calls route (`/api/call/<name>`) and the socket.

## The body

```json
{
  "error": {
    "code": "bad_request",
    "message": "name must be a string (was number)",
    "reason": "validation",
    "fields": {
      "name": { "code": "domain" },
      "title": { "code": "maxLength", "values": { "rule": 120 } }
    },
    "requestId": "0195f0b4-3c1e-7a00-8000-0000000000aa"
  }
}
```

| Part        | Always | What it says                                                                  |
| ----------- | ------ | ----------------------------------------------------------------------------- |
| `code`      | yes    | One of the eight codes below. The status follows from it                      |
| `message`   | yes    | One English sentence for API clients, logs and screens not translated yet     |
| `reason`    | no     | The feature's finer name for the refusal, such as `GROUP_NOT_FOUND`           |
| `fields`    | no     | Each failed field's code and rule, by path                                    |
| `details`   | no     | JSON a client acts on, such as the plan a refusal names                       |
| `requestId` | no     | The request log's id, to find this request in the logs                        |

Nothing else rides in the body. `apiErrorBodySchema` in `libs/domain/errors` is closed, and the
API tests read every error through it (`apps/api/_testing/api-error.ts`).

The apps word an error in the person's language with `errorText` (`libs/ui/message.ts`). It uses
the first failed field, else the reason, else the code. In English, a refusal with no field and no
known reason shows `message`, which often says more.

## Codes

The codes are the realtime transport's closed list (`REALTIME_ERROR_CODES`), so the socket and REST
never disagree.

| `code`         | Status | Also used for                                            |
| -------------- | ------ | -------------------------------------------------------- |
| `bad_request`  | 400    | 413 (body too large), 415, 422 (a file that cannot load) |
| `unauthorized` | 401    |                                                          |
| `forbidden`    | 403    | 402 (a plan refusal)                                     |
| `not_found`    | 404    | 410 (an expired or revoked link)                         |
| `conflict`     | 409    |                                                          |
| `rate_limited` | 429    |                                                          |
| `internal`     | 500    | every other 5xx                                          |
| `timeout`      | 504    | 408                                                      |

A route that keeps an older status, such as 402 for a plan refusal, passes it beside the code.

## Reasons

`ErrorReason` (`libs/domain/errors/+lib.ts`) is the closed union of every feature's error codes,
such as `NoteErrorCode` and `GroupErrorCode`. It also holds the API's own few
(`API_ERROR_REASONS`). The compiler refuses a reason that is not on it.

A refusal of the shared middleware has no reason: a session guard, the `Origin` check or a rate
limit. Neither has an error no route handled.

## Fields

`fields` has two sources:

| Source                | Codes                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| A schema refused it   | arktype's own: `required`, `domain`, `maxLength`, `pattern`, `predicate` |
| A feature's own check | Its own, such as `unsafeCharacters`, `hexColor`, `slug` and `range`      |

A schema's errors come from `fieldErrors` in `@spy4x/validation`, never from arktype's `.summary`.
The `errors` catalog (`i18n/errors/en.ts`, `Field.*`) has a sentence for each code.

`values` holds the rule: `rule`, `exclusive`, or `min` and `max` for a range. For
`unknownLanguage` it holds the language tag the request sent.

## Build one

A route answers with `errorResponse(c, code, { message, reason?, fields?, details?, status? })`.
For a body a schema refused, it answers with `validationResponse(c, errors)`. Both live in
`apps/api/services/error-response.ts`.

- `tests/api-error-shape.test.ts` fails on a route that builds an error body of its own.
- The app's `onError` answers an unhandled error as `internal`, with the message `Request failed`.
  The log keeps the cause.
- `libraryRefusals` turns the shared middleware's `{ error: "…" }` into this body. It keeps the
  status, the message and the headers.

## Read one

| Client                  | How it reads the error                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `apiFetch`              | `error.code`, `error.message`, `error.reason` and `error.fields`           |
| Plain `fetch`           | `readApiError` from `@domain/errors`; `null` for a body not from the API   |
| The socket              | `RealtimeRequestError`, with `code`, `message`, `reason`, `fields`, `details` |

`apiFetch` comes from `@spy4x/platform/api`. Use plain `fetch` when you need `details`. On the
socket, `details.code` repeats the reason, since the library's retry rule reads it.

A REST read hands `error.reason` to `ReadRefused`. An answer with no reason is taken for a proxy's
([offline-data.md](offline-data.md#which-answers-count-as-unreachable)).

## Next

- [Ids](ids.md)
- [Architecture](architecture.md)
