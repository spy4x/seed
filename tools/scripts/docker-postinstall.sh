#!/bin/bash

docker compose down

./tools/scripts/init-docker-images.sh

docker compose up -d
