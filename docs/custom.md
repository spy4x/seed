### Install:
`$ yarn`

### Local development:
- `$ yarn serve:emulator # Launch all: Firebase Emulator with local Cloud Functions, Auth, Hosting and PubSub`
- `$ yarn start <appName> # Serve that app, example: "$ yarn start back-cloud-functions"`
- `$ yarn build <appName> # Build that app, example: "$ yarn build back-cloud-functions --watch"`

### Tests (use "--watch" option if needed):
- `$ yarn test <app/library name> # Examples: "back-cloud-functions", "front-admin", "back-api-users", etc`
- `$ yarn e2e e2e-admin`
- `$ yarn e2e e2e-client`

## Scripts Sandbox

Sandbox is used to run custom scripts or migrations from your local machine to production or staging environment.

It's located in `apps/dev/sandbox/src/main.ts`.

Edit `main.ts` file as you wish. You can import and run a migration or write your own script using prepared NestApp with all backend modules included.

To run sandbox execute:
```
$ GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key-for-PROD-or-STAGING-env.json" yarn start dev-sandbox
```

### ⚠️ Note: Note that sandbox doesn't stop once script is executed. Nx is watches for files changes and restarts the script.
That may lead to unwanted re-run of your script/migration, so make sure they are written in idempotent style.

This behaviour will be changed once a bug in Nrwl Nx is fixed: https://github.com/nrwl/nx/issues/4054
