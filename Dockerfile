# Dockerfile for the Webcite MCP server, built from source.
# Default command: Streamable HTTP server (remote MCP, mcp.webcite.co).
# stdio server (Docker MCP Catalog, local clients): run `node dist/index.js`.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY README.md ./
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV WEBCITE_MCP_PROFILE=core
ENV WEBCITE_API_URL=https://api.webcite.co
EXPOSE 8787
CMD ["node", "dist/http-server.js"]
