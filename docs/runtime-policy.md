# Runtime policy

Seed's product runs unchanged on Deno, Node and Bun. This policy replaces the "Deno only" rule of
[ADR 001](decisions/001-deno-platform-template.md); the plan for getting there is
[#623](https://github.com/spy4x/seed/issues/623).

- **The code runs on all three runtimes.** Write application code (`apps/` and `libs/`) with web
  standards: `fetch`, `Request` and `Response`, `URL`, Web Crypto, Web Streams, `AbortController`,
  `TextEncoder`, ES modules, and `@std/*` packages that run on all three.
- **Runtime-specific calls go behind an adapter.** `Deno.*`, `process`, `Bun.*` and `node:*` modules
  for env, files, subprocesses, sockets and key-value stores belong in a small adapter in
  `@spy4x/platform` (`spy4x/ts-libs`), never in application code. Code that still calls `Deno.*`
  moves when #623 or another change touches it, not in a change of its own.
- **Deno stays the toolchain for now.** Development, checks, builds, tests and the scripts in
  `infra/scripts` use `deno` and `deno task`. Tests stay on `Deno.test`. The 2027-01-10 runtime
  review decides whether that changes.
- **Node and Bun may run and test the product.** Use them to start the API, the worker and the
  website, and for the per-runtime smoke tests #623 adds to CI.
- **npm packages** may be used where the dependency rules allow them, through `npm:` specifiers.
