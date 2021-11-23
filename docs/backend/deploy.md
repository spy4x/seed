# Deploy

## What is deployed
Each app is deployed separately, depending on if they were affected.

It's implemented via Nx affected:deploy command and each app implements its own `deploy` flow in [workspace.json](/workspace.json).

## When it is deployed
On each commit to master - Google Cloud Build (CI) uses [deploy.yaml](cloud-build/deploy.yaml) file to run `yarn ci:deploy` command with required environment variables.

CI builds: https://console.cloud.google.com/cloud-build/builds
