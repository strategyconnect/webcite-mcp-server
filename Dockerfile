# Dockerfile for remote MCP (mcp.webcite.co)
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY README.md ./
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV WEBCITE_MCP_PROFILE=core
ENV WEBCITE_API_URL=https://api.webcite.co
EXPOSE 8787
CMD ["node", "dist/http-server.js"]
