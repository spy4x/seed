FROM node:18-alpine

WORKDIR /app

# Install OpenJDK-11
RUN apk --no-cache add openjdk11 --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

RUN npm i -g firebase-tools
RUN firebase --version # Test run
