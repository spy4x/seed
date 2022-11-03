FROM node:${NODE_VERSION?error}

WORKDIR /src
# Install OpenJDK-11
RUN echo 'deb http://ftp.debian.org/debian stretch-backports main' | tee /etc/apt/sources.list.d/stretch-backports.list
RUN apt-get update && \
    apt-get install -y openjdk-11-jre-headless && \
    apt-get clean; \

RUN npm i -g firebase-tools
RUN firebase --version
EXPOSE  4400 4500 5000 5001 8001 8080 8085 9000
