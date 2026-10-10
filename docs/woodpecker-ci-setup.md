# Woodpecker CI Setup Guide

## Overview

The pipeline lives in `.woodpecker/ci.yml`. Woodpecker reads every `*.yml` file in the `.woodpecker/`
folder at the repository root as its own workflow, with no setting to change in its web interface.
Every product copied from the template gets the pipeline the moment its repository is activated in
Woodpecker.

It runs on every pull request and every push to `main`, in this order:

```
check ──┬── build
        ├── integration   (Postgres and Valkey services)
        └── e2e           (Playwright image, `deno task e2e url-filters`)
```

- `check` runs `deno task check`: format, lint, type check and unit tests.
- `build` runs `deno task build` (the SPA production build).
- `integration` runs `deno task test:integration` against a throw-away `postgres:16-alpine` service
  (user `tester`, password `ci-throwaway`, database `template_test`, reachable as host `postgres`)
  and a `valkey/valkey:8.1` service (password `ci-throwaway`, host `valkey`). It waits over TCP for
  both servers, see docs/handoff.md trap 3.
- `e2e` runs `deno task e2e url-filters` in `mcr.microsoft.com/playwright`, which ships Chromium and
  its system libraries, and installs the pinned Deno release from GitHub, checked against its
  SHA-256. Playwright's own browser download, run through
  Deno in the plain Deno image, hangs. The image tag must equal the Playwright version in
  `deno.jsonc` (`e2e` task), because the browser build in the image belongs to that version. The
  other three e2e specs, `auth-profile-ws-push`, `groups-socket` and `two-factor-sign-in`, need the full Docker stack
  and do not run in CI.

None of these steps needs a secret. A pull request from a fork waits until someone approves it in
Woodpecker, because the repository requires approval for forks.

## Deploy is not wired up

`.woodpecker/deploy.yml.example` holds the old production build and deploy steps. Woodpecker ignores
it because of the extension. The build step needs Docker inside the Deno image, which the image does
not have, and the steps had never run: the pipeline was not in a folder Woodpecker reads. Fix those
and rename the file to `deploy.yml` to turn deploys on; its header lists what to fix.

## Activating a repository

1. In Woodpecker, open the repository and enable it. The forge webhook is created for you.
2. Leave the repository's **Pipeline path** empty. Woodpecker then uses `.woodpecker/`. Setting it
   to another path (for example `infra/configs/`) hides the pipeline from every copy of the template.
3. Check that a pull request shows the `check`, `build`, `integration` and `e2e` results
   (`gh pr checks <number>`).

## Required Secrets (deploy only)

The pipeline in `ci.yml` needs none. The deploy steps in `deploy.yml.example` need these, set in
the Woodpecker repository settings. Give each secret the `push` event only, never `pull_request`:
an approved pull request can edit `ci.yml` and would otherwise read them.

### Database Configuration
- `DB_HOST` - PostgreSQL host (e.g., `db` or IP address)
- `DB_PORT` - PostgreSQL port (default: `5432`)
- `DB_NAME` - Database name (e.g., `app`)
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

### Redis/Valkey Configuration
- `KV_HOSTNAME` - Redis/Valkey host (e.g., `valkey` or IP address)
- `KV_PORT` - Redis/Valkey port (default: `6379`)
- `KV_PASSWORD` - Valkey password (`openssl rand -hex 24`); required by Valkey and the API

### Application Configuration
- `API_PORT` - API server port (e.g., `8000`)
- `SPA_PORT` - SPA port (e.g., `3000`)
- `DOMAIN` - Production domain (e.g., `app.example.com`)
- `TRAEFIK_ACME_EMAIL` - Email for Let's Encrypt certificates

### Deployment Configuration
- `SSH_TO_SERVER` - SSH connection string (e.g., `user@server.example.com`)
- `PATH_ON_SERVER` - Deployment path on server (e.g., `/opt/app`)
- `ssh_private_key` - SSH private key for deployment (as a secret)

## Setting Up Secrets in Woodpecker

### Via Web UI

1. Navigate to your repository in Woodpecker CI
2. Go to **Settings** → **Secrets**
3. Add each secret with the following configuration:
   - **Name**: Use the exact names listed above (case-sensitive)
   - **Value**: Enter the corresponding value
   - **Events**: Select `push` for deployment secrets, `push` and `pull_request` for others
   - **Images**: Leave empty or specify `denoland/deno:*` for security

### Via CLI

```bash
# Database secrets
woodpecker-cli secret add \
  --repository your-org/app \
  --name DB_HOST \
  --value "your-db-host"

woodpecker-cli secret add \
  --repository your-org/app \
  --name DB_PASSWORD \
  --value "your-secure-password"

# SSH deployment key
woodpecker-cli secret add \
  --repository your-org/app \
  --name ssh_private_key \
  --value @~/.ssh/deploy_key
```

## SSH Key Setup

### Generate Deployment SSH Key

```bash
# Generate a new SSH key pair for deployment
ssh-keygen -t ed25519 -C "woodpecker-ci-deploy" -f ~/.ssh/app_deploy

# Copy the public key to your server
ssh-copy-id -i ~/.ssh/app_deploy.pub user@server.example.com
```

### Add Private Key to Woodpecker

```bash
# Add the private key as a secret
woodpecker-cli secret add \
  --repository your-org/app \
  --name ssh_private_key \
  --value @~/.ssh/app_deploy
```

Or via the Web UI:
1. Copy the entire contents of `~/.ssh/app_deploy`
2. Add as a secret named `ssh_private_key`
3. Ensure it's only available for `push` events on `main` branch

## Pipeline Behavior

- Pull request: `check`, then `build`, `integration` and `e2e` in parallel.
- Push to `main`: the same steps.
- Push to any other branch: nothing. Open a pull request to run the pipeline.
- Tag `v<digit>*`: `ci.yml` runs again, then `release.yml` (below).

Every Deno step runs `deno install --frozen` first, so a `deno.lock` that does not match
`deno.jsonc` fails the pipeline instead of being rewritten.

## Releases

`.woodpecker/release.yml` waits for `ci.yml` and runs when a tag `v<digit>*` is pushed. Setup:

1. In the Woodpecker server, make the global secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   available to the `tag` event.
2. Set `IMAGE_PREFIX` at the top of `release.yml` (the Docker Hub name, without the image suffix).
3. Keep the images public: the product images start from the published base image.

Steps: `guard` (the tagged commit must be an ancestor of `main`), `build-base`, `publish-base`, then
`build-api`, `build-spa` and `build-mpa` in parallel, each followed by its `publish-*`. Kaniko
builds into a tar file without any secret, and crane, the only step with the token, pushes it. A
version without a pre-release suffix also gets `latest`. The worker and the migration run the API
image, so there is no worker image. How to cut a release: [README](../README.md#releases).

## Customization

### Modify the Deno version

Change the tag in every `image: denoland/deno:<version>` line of `ci.yml`, and the release URL and
SHA-256 in the three Playwright steps (`e2e`, `e2e-mpa`, `e2e-spa`). Keep them equal to `DENO_VERSION` in
`infra/envs/.env.example` and
`Dockerfile.base`.

### Add Environment-Specific Deployments

To add staging deployment:

```yaml
deploy-staging:
  image: denoland/deno:2.9.7
  environment:
    - SSH_TO_SERVER=${SSH_TO_SERVER_STAGING}
    - PATH_ON_SERVER=${PATH_ON_SERVER_STAGING}
  commands:
    # ... similar to production deploy
  when:
    - event: push
      branch: develop
  depends_on:
    - build
```

## Troubleshooting

### Build Fails on Docker Commands

**Issue**: Permission denied when accessing Docker socket

**Solution**: Ensure Woodpecker agent has Docker socket access:
```bash
# On Woodpecker agent host
chmod 666 /var/run/docker.sock
```

Or configure agent to run privileged containers.

### Deployment Fails with SSH Error

**Issue**: Host key verification failed

**Solution**: 
1. Ensure `ssh-keyscan` command in pipeline includes correct hostname
2. Verify SSH private key is properly formatted (includes `-----BEGIN` and `-----END` lines)

### Environment Variables Not Available

**Issue**: Secrets not accessible in pipeline

**Solution**:
1. Check secret names match exactly (case-sensitive)
2. Verify secret events include the trigger event (push/pull_request)
3. Check image filters if specified

## Security Best Practices

1. **Never commit secrets** - Always use Woodpecker secrets
2. **Use SSH keys** - Don't use password authentication for deployment
3. **Restrict secret access** - Limit secrets to specific events and branches
4. **Rotate keys regularly** - Update SSH keys and passwords periodically
5. **Monitor deployments** - Review deployment logs for suspicious activity

## Local Testing

Test the pipeline steps locally:

```bash
# Run the checks, the integration tests (recipe in docs/handoff.md) and one e2e test
deno task check
deno task test:integration
deno task e2e url-filters

# Build with production config
deno task compose --env-file=./infra/envs/.env.prod build

# Test deployment (dry run)
rsync -avhzru --delete --dry-run -e ssh \
  --exclude-from=infra/deploy/exclude.txt \
  --exclude='.env*' --exclude='*.env' --exclude=/infra/configs/vapid.json \
  --include-from=infra/deploy/include.txt \
  --exclude='*' \
  . user@server:/path
```

## Additional Resources

- [Woodpecker CI Documentation](https://woodpecker-ci.org/docs)
- [Woodpecker Secrets](https://woodpecker-ci.org/docs/usage/secrets)
- [Docker Compose in CI](https://woodpecker-ci.org/docs/usage/services)
