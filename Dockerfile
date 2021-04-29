FROM node:15.8.0-alpine3.12
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json","package-lock.json*","./"]
RUN npm install --production
RUN npm remove @cogsmith/xt ; npm install @cogsmith/xt
RUN apk add docker
RUN apk add curl
COPY . .
RUN node --check /app/app.js
ENTRYPOINT ["node","app.js"]