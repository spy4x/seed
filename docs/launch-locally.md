# Instruction for launching backend and frontend apps locally

## Install dependencies:
`$ yarn`

## Prepare dev database:
Backend requires PostgreSQL. 
0. Create `.env` file with `DB_CONNECTION_STRING=YOUR_VALUE_HERE` content
0. Run `$ yarn prisma generate` to apply connection string
0. Run `$ yarn prisma migrate dev` to update schema in your DB
0. Run `$ prisma db seed --preview-feature` to seed data to your DB

## Local development (use "--watch" option if needed):
- `$ yarn start <appName> # Serve that app, example: "$ yarn start back-api"`
- `$ yarn build <appName> # Build that app, example: "$ yarn build back-api --watch"`
- `$ yarn test <app/library name> # Examples: "back-api", "back-api-users", etc`
- `$ yarn e2e e2e-admin-panel`

-----

## [optional] Scripts Sandbox
Sandbox is used to run custom scripts or migrations from your local machine to production or staging environment.

It's located in `apps/dev/sandbox/src/main.ts`.

Edit `main.ts` file as you wish. You can import and run a migration or write your own script using prepared NestApp with all backend modules included.

To run sandbox execute:
```
$ GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key-for-PROD-or-STAGING-env.json" yarn start dev-sandbox
```

### ⚠️ Note
Notice that sandbox doesn't stop once script is executed. Nx is watches for files changes and restarts the script.
That may lead to unwanted re-run of your script/migration, so make sure they are written in idempotent style.

This behaviour will be changed once a bug in Nrwl Nx is fixed: https://github.com/nrwl/nx/issues/4054
