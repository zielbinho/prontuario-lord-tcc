# Imagem da API para o servidor da UEPG. Construir a partir da RAIZ do repositório:
#   docker compose build api
# (ainda não testado: validar na primeira implantação)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/ficha/package.json packages/ficha/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @lord/api --include-workspace-root=false && npm cache clean --force

COPY packages/ficha packages/ficha
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
COPY apps/api/tsconfig.json apps/api/

USER node
WORKDIR /app/apps/api
EXPOSE 3333
CMD ["npx", "tsx", "src/principal.ts"]
