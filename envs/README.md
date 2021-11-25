### To make your own environment variable file:

1. Copy `example` and name it `<envName>.env`, examples: `local.env` or `prod.env`
2. Fill it with correct values
3. Run `$ export $(cat envs/local.env | xargs)`
4. It will be used for dependent apps, like `$ yarn start back-api` or `$ yarn prisma migrate dev`

