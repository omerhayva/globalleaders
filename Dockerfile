# Global Leaders Live — üretim imajı (Node 22 + better-sqlite3)
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    GL_DB_FILE=/data/globalleaders.db

WORKDIR /app

# better-sqlite3 hazır ikili (prebuilt) indirilemezse derleyebilmek için araçlar.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 ffmpeg-static || npm rebuild better-sqlite3

COPY . .

# Derlenmiş React adacıkları imajda gelir; imaj içinde yeniden derleme gerekmez.
RUN mkdir -p /data /app/var /app/public/uploads

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
