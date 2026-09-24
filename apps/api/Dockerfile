# Imagem da API para o servidor da UEPG. Construir a partir da RAIZ do repositório:
#   docker compose build api
# (ainda não testado com Docker: validar na primeira implantação)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/ficha/package.json packages/ficha/
COPY packages/ia/package.json packages/ia/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @lord/api --include-workspace-root=false && npm cache clean --force

COPY packages/ficha packages/ficha
COPY packages/ia/src packages/ia/src
COPY apps/api/src apps/api/src
COPY apps/api/migrations apps/api/migrations
COPY apps/api/tsconfig.json apps/api/
# dados sintéticos: só usados pelo script de demonstração (src/demonstracao.ts)
COPY dados/sinteticos/casos dados/sinteticos/casos
COPY dados/sinteticos/coorte dados/sinteticos/coorte

USER node
WORKDIR /app/apps/api
EXPOSE 3333
CMD ["npx", "tsx", "src/principal.ts"]
