FROM node:12


# Update apt and install wget
RUN apt-get update && apt-get install -y wget curl sqlite3

# Project directory
WORKDIR /src/subdomain-registrar
# Copy files into container
COPY . .

RUN npm i
RUN npm run build

CMD node lib/index.js
