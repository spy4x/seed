# Docker

## Introduction
Docker is used for local development and deployment. It is a tool that allows you to create a containerized environment for your application. It is a great tool for local development, because it allows you to have the same environment as in production. It also allows you to deploy your application to any cloud provider.

Docker Compose is used to run multiple containers at once. It is used to run the application, database and other services.

## Initial setup
Run next command to prepare required docker images:
```sh
yarn docker:init
```

## After installing dependencies
Every time after you change dependencies in `package.json` you need to run:
```sh
yarn docker:postinstall
```
That will rebuild the image with updated dependencies are remove cache volume.
