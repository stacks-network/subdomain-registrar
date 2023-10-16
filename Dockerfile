FROM node:12

# Update stretch repositories
RUN sed -i -e 's/deb.debian.org/archive.debian.org/g' \
           -e 's|security.debian.org|archive.debian.org/|g' \
           -e '/stretch-updates/d' /etc/apt/sources.list
# Update apt and install wget
RUN apt-get update && apt-get install -y wget curl sqlite3

# Project directory
WORKDIR /src/subdomain-registrar
# Copy files into container
COPY . .

RUN npm i
RUN npm run build

CMD node lib/index.js
