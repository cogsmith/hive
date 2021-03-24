FROM node:15.8.0-alpine3.12
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json","package-lock.json*","./"]
RUN npm install --production
RUN apk add docker
RUN apk add curl
RUN node --check /app/app.js
COPY . .
ENTRYPOINT ["node","app.js"]