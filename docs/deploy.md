# Deploy to a server

> Also on the website: [seedsaas.com/docs/deploy](https://seedsaas.com/docs/deploy).

From a fresh Ubuntu server to a healthy deployment with HTTPS and a tested backup, in order.

**You need:**

- An Ubuntu server you can reach over SSH as root, and a domain whose DNS you control.
- A checkout of your product on your machine, with Deno installed.

The examples use `deploy@192.0.2.10` for the server and `app.example.com` for the product's host.

## The server

1. Run `getent passwd 1000` as root. If it names a user (often `ubuntu`), deploy as that user:
   use its name for `deploy` from here on.
2. Make the deploy user with uid 1000, give it root's SSH keys, and turn off password and root
   logins. Pasting this block twice gives the same result as pasting it once:

   ```sh
   { id deploy >/dev/null 2>&1 || adduser --uid 1000 --disabled-password --gecos '' deploy; } &&
   [ "$(id -u deploy)" = 1000 ] && mkdir -p ~deploy/.ssh && touch ~deploy/.ssh/authorized_keys &&
   { grep -vxFf ~deploy/.ssh/authorized_keys ~/.ssh/authorized_keys \
       >> ~deploy/.ssh/authorized_keys || [ $? -eq 1 ]; } &&
   chown -R deploy:deploy ~deploy/.ssh && chmod 700 ~deploy/.ssh &&
   chmod 600 ~deploy/.ssh/authorized_keys &&
   printf 'PasswordAuthentication no\nPermitRootLogin no\n' \
     > /etc/ssh/sshd_config.d/01-deploy.conf &&
   systemctl reload ssh &&
   sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '
   ```

3. Check that the last command printed `no` twice.
4. From your machine, check that `ssh deploy@192.0.2.10` works before you close the root session.
5. As root, install Docker with its Compose plugin, rsync and unzip, and let the deploy user run
   Docker:

   ```sh
   curl -fsSL https://get.docker.com | sh
   apt-get install -y rsync unzip
   usermod -aG docker deploy
   ```

6. As `deploy`, install Deno:

   ```sh
   curl -fsSL https://deno.land/install.sh | sh
   ```

The containers run as uid 1000 and read the web push keys, which only their owner may read. That is
why the deploy user needs that uid. The SSH file's name sorts first because SSH keeps the first
value it reads, and a provider's own file may turn passwords back on. Membership of the `docker`
group is as good as root, so keep the deploy user's key as safe as root's.

## The firewall

Only SSH, 80 and 443 may answer from outside. On the server, as root:

```sh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

Docker opens the ports it publishes past `ufw`. Postgres, Valkey and Grafana stay private because
they are published on `127.0.0.1` only: never change `DB_HOST_PORT`, `KV_HOST_PORT` or
`GRAFANA_HOST_PORT` to `0.0.0.0`. The provider's firewall outside the server, such as a Hetzner
Cloud Firewall, is the safer place for this rule, since Docker cannot open it.

After the first deploy, `ss -tlnp` as root must list no address but `127.0.0.1` and `[::1]` for
every port other than 22, 80 and 443.

## DNS

Create an `A` record, and an `AAAA` record for IPv6, pointing at the server for every host:

| Host                             | When                                     |
| -------------------------------- | ---------------------------------------- |
| `DOMAIN`                         | Always: the SPA, the API and file store. |
| `MPA_DOMAIN`                     | With the `mpa` profile.                  |
| `ADMIN_DOMAIN`                   | With the `admin` profile.                |
| each host in `MPA_REDIRECT_RULE` | When the rule is set.                    |

Let's Encrypt checks each host over port 80, so the records must resolve before the first deploy.
`dig +short app.example.com` must answer `192.0.2.10`.

## The env file

1. On your machine, copy the example:

   ```sh
   cp infra/envs/.env.example infra/envs/.env.prod
   ```

2. Set the values below. [Settings](settings.md) describes every variable.

   | Variable                               | Value                                                               |
   | -------------------------------------- | ------------------------------------------------------------------- |
   | `ENV`                                  | `prod`                                                              |
   | `PROJECT`                              | Your product's name, lowercase.                                     |
   | `DOMAIN`, `MPA_DOMAIN`, `ADMIN_DOMAIN` | The hosts from the DNS step.                                        |
   | `TRAEFIK_ACME_EMAIL`                   | A real address for certificate notices.                             |
   | `SSH_TO_SERVER`                        | `deploy@192.0.2.10`                                                 |
   | `PATH_ON_SERVER`                       | The app's directory on the server.                                  |
   | `PROXY_HTTPS_HOST_PORT`                | `443`                                                               |
   | `PROXY_HTTP_HOST_PORT`                 | `80`                                                                |
   | `COMPOSE_PROFILES`                     | Add `mpa` and `admin` when you use them: [The three apps](apps.md). |

   The proxy listens on `127.0.0.1` unless you set the two ports, because in development it serves
   routes that make anyone an administrator. `443` and `80` publish on every IPv4 and IPv6 address;
   `0.0.0.0:443` would leave IPv6 visitors out.

3. Leave `backup` out of `COMPOSE_PROFILES` for now: you set it up after the first deploy.
4. Give every secret a value of its own:

   | Secrets                                                                                     | Command                         |
   | ------------------------------------------------------------------------------------------- | ------------------------------- |
   | `DB_PASS`, `AUTH_COOKIE_SECRET`, `AUTH_PEPPER`, `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET` | `openssl rand -hex 32`          |
   | `KV_PASSWORD`, `GRAFANA_PASS`                                                               | `openssl rand -hex 24`          |
   | `S3_ACCESS_KEY_ID`                                                                          | `GK` and `openssl rand -hex 12` |

5. Encrypt the file into the repository, and keep its key in a password manager:

   ```sh
   deno task env:encrypt
   ```

Mail, billing and the rest are optional. The deploy refuses a file that does not set `ENV=prod`,
or that keeps a secret from the example or leaves one empty, and names each.

The file stays on your machine. Every deploy copies it to `infra/envs/.env` on the server and
replaces what is there, so edit it here, never on the server. It holds the only copy of the secrets
and the file store's key, and the backup does not hold it ([env files](development.md#env-files)).

## The first deploy

1. Create the app's directory on the server:

   ```sh
   ssh deploy@192.0.2.10 mkdir -p <PATH_ON_SERVER>
   ```

2. Deploy from your machine:

   ```sh
   deno task deploy
   ```

3. Start the shared proxy, once per server, in the app's directory on the server:

   ```sh
   ssh deploy@192.0.2.10
   cd <PATH_ON_SERVER> && deno task proxy:start
   ```

Every deploy applies pending migrations before the API and the worker start, and a failed migration
fails the deploy. `deno task compose logs migrate` on the server shows what it did. The deploy also
creates the web push keys when they are missing.

The proxy asks Let's Encrypt for each host's certificate as soon as it starts. When a host still
shows a self-signed certificate after a few minutes, see [HTTPS certificates](certificates.md).

## Check it

1. On the server, list the containers. Each must be running, and healthy where it has a check:

   ```sh
   deno task compose ps
   ```

2. From your machine, check the redirect:

   ```sh
   curl -sI http://app.example.com
   ```

3. Check the API's health. It must print `"status":"ok"` and `200`, without `-k`, which proves the
   certificate:

   ```sh
   curl -sS -w '\n%{http_code}\n' https://app.example.com/api/health
   ```

`"down"` with 503 means the API cannot reach the database. `"degraded"` with 200 means the cache or
the file store is down; its `checks` entry is `false`.

## Next

- [Give operators access](operator-access.md): the first operator, then sign in at `ADMIN_DOMAIN`.
- [Backups](backups.md): set them up, then rehearse a restore.
- [Deploy an update](deploy-updates.md)
