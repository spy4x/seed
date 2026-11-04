# Runtime policy

Seed runs on Deno today and is moving to run unchanged on Deno, Node and Bun
([#623](https://github.com/spy4x/seed/issues/623)). This policy replaces the "Deno only" rule of
[ADR 001](decisions/001-deno-platform-template.md).

- **New code runs on all three runtimes**, and so does old code a change touches anyway. Write
  application code (`apps/` and `libs/`) with web standards: `fetch`, `Request` and `Response`,
  `URL`, Web Crypto, Web Streams, `AbortController`, `TextEncoder`, ES modules, and `@std/*`
  packages that run on all three.
- **Runtime-specific calls go behind an adapter.** `Deno.*`, `process`, `Bun.*` and `node:*` modules
  for env, files, subprocesses, sockets and key-value stores belong in a small adapter in
  `@spy4x/platform` ([ts-libs](https://github.com/spy4x/ts-libs)), never in application code. The
  `Deno.*` calls that remain move under #623, or when a change touches them anyway.
- **Deno stays the toolchain for now.** Development, checks, builds, tests and the scripts in
  `infra/scripts` use `deno` and `deno task`. Tests stay on `Deno.test`. The runtime review due
  2027-01-10 decides whether that changes.
- **Node and Bun may be used to test code that already runs on them**, and for the per-runtime
  smoke tests #623 will add to CI. The API and the worker start on Node and Bun
  ([#748](https://github.com/spy4x/seed/issues/748)): `APP_RUNTIME` picks the runtime
  ([apps.md, "Runtime"](apps.md#runtime)). The website starts on Node and Bun only once #623
  says it does.
- **npm packages** come in through `npm:` specifiers, only where the dependency rules allow them.
