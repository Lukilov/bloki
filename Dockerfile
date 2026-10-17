# Bloki server: builds the web app, then runs server.mjs with the data in /data (mount a volume there).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 BLOKI_DATA=/data
COPY --from=build /app/package.json /app/server.mjs /app/collab.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4321
CMD ["node", "server.mjs"]
