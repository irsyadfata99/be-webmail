ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production
# openssl dipakai untuk membuat hash SHA512-CRYPT (password dikirim lewat stdin, bukan argumen).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src ./src
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.ts"]
