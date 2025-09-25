# Build stage: compile the React/Vite app
FROM node:20-alpine AS build
ARG BUILD_ID=dev
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage: Nginx
FROM nginx:alpine
ARG BUILD_ID=dev
LABEL build.id=$BUILD_ID
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
