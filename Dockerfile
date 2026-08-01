# The server has no dependencies, so there is nothing to install and no
# lockfile to honour — the image is Node plus the source.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

EXPOSE 8080
CMD ["node", "src/index.js"]
