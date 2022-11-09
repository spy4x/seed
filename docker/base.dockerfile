# TODO: Use "node:18-alpine" and remove installation of "openssl" when this issue is solved: https://github.com/prisma/prisma/issues/8478
FROM node:18

# For Alpine - install build dependencies
#RUN apk add --no-cache --virtual .gyp py3-pip make g++

WORKDIR /app

# install app dependencies
COPY package.json yarn.lock ./
RUN yarn
