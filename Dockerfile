FROM node:20-slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-cjk \
      libatk-bridge2.0-0 \
      libgtk-3-0 \
      libgbm1 \
      libnss3 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      wget \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    # Allow unprivileged Chrome/Chromium
    Chromium --version 2>/dev/null || true && \
    ln -s $(which chromium) /usr/bin/chrome 2>/dev/null || true

# ---------- Backend ----------
FROM base AS backend-build
WORKDIR /app
COPY backend/package.json backend/tsconfig.json ./
RUN npm ci
COPY backend/src ./src
RUN npm run build

# ---------- Frontend ----------
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts ./
RUN npm ci --omit=dev 2>/dev/null; npm ci || true
COPY frontend/index.html frontend/tailwind.config.js frontend/postcss.config.js ./
COPY frontend/src ./src
RUN npm run build || npx vite build

# ---------- Runtime ----------
FROM base
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0
WORKDIR /app
COPY --from=backend-build /app/dist ./dist
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/dist ./frontend/dist

RUN mkdir -p /app/uploads /app/output
USER node

EXPOSE 4000
CMD ["node", "dist/index.js"]
