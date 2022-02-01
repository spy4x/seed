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
