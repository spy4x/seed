FROM gcr.io/cloud-builders/gcloud

# Install Docker - BEGIN
ARG DOCKER_VERSION=5:19.03.8~3-0~ubuntu-xenial
RUN apt-get -y update && \
    apt-get -y install \
        apt-transport-https \
        ca-certificates \
        curl \
        make \
        software-properties-common && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add - && \
    apt-key fingerprint 0EBFCD88 && \
    add-apt-repository \
       "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
       xenial \
       edge" && \
    apt-get -y update && \
    apt-get -y install docker-ce=${DOCKER_VERSION} docker-ce-cli=${DOCKER_VERSION}
# Install Docker - END

RUN rm /bin/sh && ln -s /bin/bash /bin/sh

# Install Node - BEGIN
ENV NVM_DIR /usr/local/nvm
RUN mkdir $NVM_DIR
ENV NODE_VERSION 14.17.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
RUN source $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default
# add node and npm to path so the commands are available
ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH
RUN npm i -g yarn
# Install Node - END


RUN apt -y autoclean
RUN apt-get -y clean
RUN apt -y autoremove

ENTRYPOINT ["bash"]
