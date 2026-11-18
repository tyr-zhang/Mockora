# syntax=docker/dockerfile:1

FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 算法题功能需要在容器内执行候选人提交的 Python / Java 代码
RUN apt-get update && apt-get install -y --no-install-recommends python3 default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

# Next.js standalone 输出：只拷贝运行所需的最小文件集
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
