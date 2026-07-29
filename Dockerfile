FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN rm -rf dist && npm run build

EXPOSE 8080

CMD ["node", "server.js"]
