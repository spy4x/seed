FROM node:18-alpine

WORKDIR /usr/src/app

COPY dist/apps/back/api/package.json ./package.json

RUN yarn --production --no-lockfile --non-interactive

COPY prisma/* ./prisma/

RUN yarn prisma generate

COPY dist/apps/back/api/* ./

CMD node ./main.js
