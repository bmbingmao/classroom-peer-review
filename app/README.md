# app —— 源码与开发说明

> 项目介绍、截图、部署和设计取舍请看 [根目录 README](../README.md)。

## 目录

```
src/server/          后端（Node 直接跑 .ts，无编译步骤）
  index.ts           入口：路由挂载、静态托管、bootstrap
  schema.sql         全部建表语句（幂等，启动时执行）
  db.ts              node:sqlite 封装 + WAL/busy_timeout + 事务
  scoring.ts         去极值算法（纯函数，独立可测）
  ai.ts              AI 审核调用（OpenAI 兼容，8 秒超时）
  ai-worker.ts       异步审核队列
  points.ts          积分记账（可为负）
  crypto.ts          API Key 加密（AES-256-GCM）
  routes/            auth / admin / groups / activities / student / comments / points / results / export / misc
src/web/             前端（React + Vite）
  App.tsx            hash 路由
  components/        CommentWall / Chart（手写 SVG）/ aiPresets
  pages/             登录、教师端 5 页、学生端 4 页、管理端
scripts/             测试与演示脚本
```

## 开发

```bash
pnpm install
pnpm dev          # 后端 :3000
pnpm dev:web      # 前端 Vite :5173（自动代理 /api）
pnpm build        # 构建前端到 dist/web
pnpm typecheck    # 前端类型检查
pnpm seed         # 灌演示数据（需干净实例）
```

## 测试

```bash
./scripts/verify.sh          # 接口 136 + P1 接口 80 + 界面 39 + 并发 50
./scripts/verify-docker.sh   # 镜像构建 + 容器实跑 + 数据持久化
```

真浏览器验证（需要 `npm i -D playwright && npx playwright install chromium`）：

```bash
BASE=http://127.0.0.1:3988 node scripts/browser-check.mjs
BASE=http://127.0.0.1:3988 node scripts/browser-check-p1.mjs
```

## 一些实现约定

- 时间一律存 **UTC 毫秒整数**，展示层转本地；容器里设 `TZ=Asia/Shanghai`。
- 权限过滤在 SQL 里做（`WHERE teacher_id = ?`），不靠前端藏按钮。
- 匿名 = 接口不下发身份，不是前端隐藏。
- 评分草稿存 `score_drafts`，与正式分表分离，避免污染统计。
- 到期关闭由服务端派生状态（`effectiveStatus`），不依赖定时任务也不依赖前端。
