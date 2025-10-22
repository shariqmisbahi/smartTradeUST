FROM node:20-alpine

WORKDIR /usr/src/app

# Build deps for native modules (if any)
RUN apk add --no-cache python3 make g++ bash

# Install Angular CLI globally so 'ng' is always available
RUN npm i -g @angular/cli@17

# Install project deps
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Port
EXPOSE 4100

# Start Angular dev server
CMD ["bash","-lc","ng serve --host 0.0.0.0 --port 4100 --poll 2000"]
