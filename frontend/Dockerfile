# Стадия сборки; моки в прод-бандл не попадают (VITE_API_MOCKS не задаём — false по умолчанию)
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Статика через nginx с прокси на api (нодев же dev-режим не заворачиваем в контейнер)
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
