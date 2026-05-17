# Stage 1: Build dashboard
FROM node:20-alpine AS dashboard-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY vite.config.ts ./
COPY src/dashboard/ ./src/dashboard/
COPY index.html ./src/dashboard/ 2>/dev/null || true
RUN npm run build:dashboard

# Stage 2: Build TypeScript
FROM node:20-alpine AS ts-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=ts-builder /app/dist ./dist
COPY --from=dashboard-builder /app/public ./public
COPY LICENSE README.md ./
ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["dashboard"]
