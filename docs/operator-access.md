# Give operators access

> Also on the website: [seedsaas.com/docs/operator-access](https://seedsaas.com/docs/operator-access).

How to make the first administrator of the admin app, give people roles, and open Grafana.

**You need** a deployed server with the `admin` profile on ([Deploy the admin app](apps.md#deploy-the-admin-app)).

## The first operator

1. On the server, in `PATH_ON_SERVER`, run the command in the worker container:

   ```sh
   deno task compose exec worker deno task operator:create seller@example.com
   ```

2. Type the password twice. It is 8 to 50 characters, and nothing you type is shown.
3. Sign in at `ADMIN_DOMAIN` with the address and that password.

The command makes the person an administrator. When nobody signs in with the address, it creates
the account with its address proven. It needs no mail, so it works for a product without mail or
without sign-up.

When somebody already signs in with the address, it only makes them an administrator; their
password stays. Running it again changes nothing. Each role change writes an audit row on the person
naming `cli:operator-create`.

From a script, send the password as the first line of standard input, and add `-T` so Compose gives
the command no terminal. Keep the password out of the command line, where the shell history and
the process list would keep it:

```sh
ssh <SSH_TO_SERVER> 'cd <PATH_ON_SERVER> &&
  deno task compose exec -T worker deno task operator:create seller@example.com' < password.txt
```

## Give a role

Roles are `viewer` (everyone, by default), `operator`, `supervisor` and `administrator`. Operator
and above open the admin app.

- **In the admin app:** an administrator gives a person a role below their own.
- **On the server:** run `user:role` in the worker container:

  ```sh
  deno task compose exec worker deno task user:role ada@example.com operator
  ```

`user:role` finds the person by the address they sign in with, and exits with 1 when nobody does.
Each change writes an audit row on the person naming `cli:user-role`.

An administrator is made only by `operator:create`, by `user:role <address> administrator`, by the
development seed, or on the public demo by `DEMO_ADMIN_PASSWORD` ([The public demo](demo.md)).

## Admin consoles

With the `monitoring` profile, Grafana runs with no public address: it is published on
`127.0.0.1:3000` only. Sign in as `admin` with `GRAFANA_PASS`.

- **On your machine:** open `http://localhost:3000`.
- **On a server:** open a tunnel, then open `http://localhost:3000`:

  ```sh
  ssh -L 3000:127.0.0.1:3000 <SSH_TO_SERVER>
  ```

When port 3000 is taken, set `GRAFANA_HOST_PORT` to another `127.0.0.1:<port>`. Never publish it on
`0.0.0.0`.

### Change Grafana's password

Grafana reads `GRAFANA_PASS` only on its first start, so changing the env file later does nothing.

1. Give the new password to Grafana's own command. Type it, then press Ctrl+D, so it stays out of
   the shell history:

   ```sh
   deno task compose exec -T grafana grafana cli admin reset-admin-password --password-from-stdin
   ```

2. Put the same value in `GRAFANA_PASS`, so the env file says what Grafana uses.

## Next

- [The three apps](apps.md#the-admin-app): what operators do in the admin app.
- [Backups](backups.md)
