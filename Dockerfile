FROM node:22-alpine AS build

WORKDIR /app/backend

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY --from=build /app/backend/dist ./dist
COPY src/config/dashboards ./src/config/dashboards
COPY src/config/rbac ./src/config/rbac

USER node

EXPOSE 8080

CMD ["node", "dist/src/server.js"]
