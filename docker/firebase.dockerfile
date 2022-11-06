FROM node:18-alpine

WORKDIR /src

# Install OpenJDK-11
RUN apk --no-cache add openjdk11 --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

RUN npm i -g firebase-tools
RUN firebase --version # Test run

EXPOSE  4000 4400 4500 5000 5001 8001 8080 8085 9000
