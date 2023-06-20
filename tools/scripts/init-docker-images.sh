#!/bin/bash

# Remove old dependencies volume
docker volume rm seed_node-modules -f

# Rebuild base image
docker image rm seed_base -f
docker build -t seed_base -f docker/base.dockerfile .

# Rebuild Firebase Emulator image
docker image rm seed_firebase -f
docker build -t seed_firebase -f docker/firebase.dockerfile .
