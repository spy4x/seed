FROM node:18-alpine
WORKDIR /app
# install build dependencies
RUN apk add --no-cache --virtual .gyp py3-pip make g++

# install app dependencies
COPY package.json yarn.lock ./
RUN yarn
