FROM node:20-bookworm-slim

WORKDIR /app

# Instala dependencias primero (aprovecha la cache de Docker si el código cambia pero no el package.json)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copia solo lo necesario para correr el bot
COPY index.js list-voices.js ./

CMD ["node", "index.js"]
