# Imagen de Eventia (backend Express + frontend estático).
# node:sqlite requiere Node 22.13 o superior; se usa la variante slim de Node 24 LTS.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Primero solo los manifiestos, para aprovechar la caché de capas al reconstruir.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# El contenedor no se ejecuta como root.
USER node

ENV PORT=3005
EXPOSE 3005

# Docker marca el contenedor como "healthy" solo si la API responde y alcanza la base de datos.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
