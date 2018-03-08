FROM ubuntu:xenial


# Update apt and install wget
RUN apt-get update && apt-get install -y wget curl apt-utils git

# Install node
RUN curl -sL https://deb.nodesource.com/setup_6.x | bash -
RUN apt-get update && apt-get install -y nodejs

# Project directory
WORKDIR /src/subdomain-registrar
# Copy files into container
COPY . .

RUN npm i && npm ln blockstack

CMD npm run start
