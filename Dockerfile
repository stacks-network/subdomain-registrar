FROM ubuntu:xenial


# Update apt and install wget
RUN apt-get update && apt-get install -y wget curl apt-utils git

# Install node
RUN curl -sL https://deb.nodesource.com/setup_6.x | bash -
RUN apt-get update && apt-get install -y nodejs

# Let's install blockstack.js
WORKDIR /src/
RUN git clone https://github.com/blockstack/blockstack.js.git
RUN cd blockstack.js && git checkout feature/blockstack-operations
RUN cd blockstack.js && npm i && npm run build && npm ln

# Project directory
WORKDIR /src/subdomain-registrar
# Copy files into container
COPY . .

RUN npm i && npm ln blockstack

CMD npm run start
