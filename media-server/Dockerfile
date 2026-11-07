# Servidor de mídia do Project Club (mediasoup). Imagem pequena; o worker
# nativo do mediasoup vem pré-compilado pra linux x64 (sem build de C++).
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
# python3/make/g++ só entram se o binário pré-compilado não existir pra
# plataforma (ex.: ARM) — aí o mediasoup compila o worker na instalação.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
USER node
EXPOSE 4443
CMD ["node", "src/index.js"]
