# Imagen para desplegar "Mi Serie Mágica" en Render (o cualquier host que
# soporte Docker). Instala ffmpeg (con soporte de flite para la voz
# placeholder) y Python/Pillow para las imágenes placeholder, además de
# Node para el backend.
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pil \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# Render (y la mayoría de los hosts) inyectan la variable PORT en runtime;
# server/index.js ya la respeta (process.env.PORT || 3000).
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]
