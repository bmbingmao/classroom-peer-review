# 多阶段构建：前端用 Vite 构建，后端用 Node 直接跑 TypeScript（Node ≥22.6 原生支持类型剥离）
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
# 不带 NODE_ENV，确保 devDependencies（vite）也装上
RUN npm install --no-audit --no-fund
COPY . .
# 构建时必须 production，否则 React 会打进 dev 版，包体积翻倍
RUN NODE_ENV=production npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai \
    DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist

VOLUME ["/data"]
EXPOSE 3000

# 健康检查：能拿到 401 就说明服务活着
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/me').then(()=>process.exit(0)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.ts"]
