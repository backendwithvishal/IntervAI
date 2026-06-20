# ==========================================
# STAGE 1: Build Dependencies
# ==========================================
FROM node:20-alpine AS dependencies

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --only=production

# ==========================================
# STAGE 2: Production Build
# ==========================================
FROM node:20-alpine AS production

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install wget for health checks
RUN apk add --no-cache wget && \
    mkdir -p exports logs && \
    chown -R node:node /usr/src/app

# Copy dependencies and source code
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --chown=node:node . .

# Run as non-root user
USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:8000/health || exit 1

CMD ["node", "index.js"]