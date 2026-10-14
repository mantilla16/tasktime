# Imagen de la app: Node sin dependencias de desarrollo. La base de datos va en
# otro contenedor (ver docker-compose.yml); las claves llegan por .env.
FROM node:22-alpine

ENV NODE_ENV=production \
    TZ=America/Bogota

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/auth >/dev/null || exit 1

USER node
CMD ["node", "server.js"]
