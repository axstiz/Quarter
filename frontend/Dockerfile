# Стадия сборки; моки в прод-бандл не попадают (VITE_API_MOCKS не задаём — false по умолчанию)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Статика через nginx с прокси на api (нодев же dev-режим не заворачиваем в контейнер)
FROM nginx:alpine
# entrypoint-скрипт ipv6-by-default периодически висит на чтении pipe в нашем окружении — не нужен
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
