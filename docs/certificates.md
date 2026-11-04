# HTTPS certificates

> Also on the website: [seedsaas.com/docs/certificates](https://seedsaas.com/docs/certificates).

How the proxy gets a certificate for every host, how to retry one that failed, and how to send
other hosts to the website.

**You need** a server deployed as [Deploy to a server](deploy.md) says, with the proxy started.

## How it works

The proxy asks Let's Encrypt for each host's certificate as soon as it starts. Until a certificate
arrives, the host answers with Traefik's own self-signed one. Plain `http://` on `DOMAIN` and
`MPA_DOMAIN` answers a permanent redirect to HTTPS.

| Variable                | What it does                                              | Default      |
| ----------------------- | --------------------------------------------------------- | ------------ |
| `TRAEFIK_ACME_EMAIL`    | Where Let's Encrypt sends expiry notices. Set a real one. | empty        |
| `TRAEFIK_CERT_RESOLVER` | The resolver the production routes ask for a certificate. | `myresolver` |

`infra/compose/compose.proxy.yml` defines that resolver: Let's Encrypt over port 80, with the
certificates in `.volumes/traefik/letsencrypt/acme.json`. The proxy serves nothing of its own but
`/ping`. Its dashboard and API are off, because they would list every project's routes.

## Retry a missing certificate

1. On the server, find the host that got none:

   ```sh
   docker logs traefik
   ```

2. Fix that host's DNS record, and wait until `dig +short <host>` answers the server's address.
3. Restart the proxy, in the app's directory on the server:

   ```sh
   deno task proxy:stop && deno task proxy:start
   ```

Do not retry again and again while DNS is still wrong. Let's Encrypt allows 5 failed validations per
host per hour, then gives one back every 12 minutes
([rate limits](https://letsencrypt.org/docs/rate-limits/#authorization-failures-per-identifier-per-account)).
A deploy that recreates the app's containers also retries every host still without a certificate;
a deploy that changes nothing does not.

## Redirect other hosts to the website

1. Point each host's DNS record at the server.
2. In the env file, set `MPA_REDIRECT_RULE` to a Traefik rule. Join hosts with `||`:

   ```text
   MPA_REDIRECT_RULE=Host(`www.example.com`) || Host(`old.example.com`)
   ```

3. Deploy. Each host then answers a permanent redirect to the same path on `MPA_DOMAIN`, and
   Traefik gets its certificate.

The rule works in production only. Empty, it matches nothing.

## Next

- [Deploy to a server](deploy.md#check-it): check the deployment.
- [Run several projects on one server](several-projects.md): share one Traefik.
