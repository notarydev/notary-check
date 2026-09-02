FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/tsconfig.json ./server/
RUN cd server && npm ci
COPY server/src ./server/src
RUN cd server && npx tsc

FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY ui/dist ./ui/dist
WORKDIR /app/server
EXPOSE 3333
CMD ["node", "dist/server.js"]
