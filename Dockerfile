FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8765

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/share ./share

EXPOSE 8765
EXPOSE 9000

CMD ["node", "server/hub.mjs"]
