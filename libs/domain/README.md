# Domain libraries

Product business rules plus command, event, and query contracts belong here. Domain code may
depend on platform code, but not frameworks, storage adapters, client code, server code, or apps.
Each folder is one workspace member for one aggregate (`groups`, `identity`, `notes`, `tags` and the
rest; `deno.jsonc` lists them), imported through its `@domain/<name>` alias.
