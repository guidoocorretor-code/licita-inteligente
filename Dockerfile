FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN mkdir -p storage && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK CMD wget -qO- http://localhost:3000/saude || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
