# 课堂互评 / 投票评分系统

局域网课堂用的互评与投票系统。纯网页（手机/PC 自适应），Docker 一键部署。

需求依据：`../需求规格书-v2.md`；需求评审意见：`../需求评审报告.md`。

---

## 现在就能点开看（本机已运行）

```
http://192.168.3.103:3000        ← 手机和电脑都能开（同一局域网）
http://127.0.0.1:3000            ← 本机
```

演示账号：

| 角色 | 账号 | 密码 | 能看到什么 |
|---|---|---|---|
| 教师 | `teacher1` | `teach123` | 2 个评价项（1 评分 + 1 投票）、5/8 人已交、去极值明细、未交名单、入场二维码 |
| 学生（已交） | `2023001` | `pw2023001` | 已参与（浅蓝卡）、结果页 |
| 学生（未交） | `2023003` | `2023003` | 首次登录要求改密，改完能看到**未参与（深蓝卡）** |
| 超管 | `admin` | `admin6666` | 教师账号管理 |

进程是本机手动起的（不是 systemd）。停：

```bash
kill "$(cat /tmp/peer-review.pid)"
```

重新起（数据在 `app/data`，不会丢）：

```bash
cd ~/AI工作区/课堂互评系统/app && nohup node src/server/index.ts > /tmp/peer-review.log 2>&1 & echo $! > /tmp/peer-review.pid
```

重灌演示数据：删掉 `app/data` 再起，然后 `BASE=http://127.0.0.1:3000 pnpm seed`。

---

## Docker 部署

```bash
cd app
cp .env.example .env      # 改 ADMIN_PASSWORD / PORT
docker compose up -d --build
```

> ✅ **已在开发机实测通过**（2026-10-19，docker 29.9.1 + compose 5.6.0，alpine 基础镜像 323MB）：
> 镜像构建成功 → 容器健康 → 接口冒烟 136 项 + P1 冒烟 75 项全过 → 重启容器数据不丢 → 真浏览器 27 项全过。
> 想自己复验：`sudo bash scripts/verify-docker.sh 3100`

### Docker Hub 连不上时

本机实测 `registry-1.docker.io` 直连超时（代理不覆盖 docker 守护进程）。已在 `/etc/docker/daemon.json` 配了镜像源：

```json
{ "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run", "https://dockerproxy.net"] }
```

改完 `sudo systemctl restart docker`。换机器部署时如果拉不动基础镜像，先照这个配。

### 日常操作

```bash
sudo docker compose up -d          # 起
sudo docker compose ps             # 看状态（healthy 就是好的）
sudo docker compose logs -f app    # 看日志
sudo docker compose down           # 停（数据卷保留）
sudo docker compose down -v        # 连数据一起删（慎用）
```

### 注意

- 数据在命名卷 `peerdata`（`/data`：`app.db` + `uploads/`）。**不要接到 SMB/NFS 共享盘上** —— SQLite 的 WAL 在网络文件系统上无法工作，会直接打不开库。
- 局域网 HTTP 访问时 `.env` 里 `COOKIE_SECURE` 必须是 `false`，否则登录后 cookie 不发送（表现为"登录没反应"）。
- `ADMIN_PASSWORD` 只在**首次启动**（库里还没有 admin 时）生效。

### 备份

```bash
docker run --rm -v peerdata:/d -v "$PWD":/b alpine tar czf /b/backup-$(date +%F).tgz -C /d .
```

---

## 老师端 / 学生端的两处行为约定

**评语默认匿名**：教师看评语墙、待审队列时，作者一律显示「匿名学生」，只有点右上角**「👁 显示真实身份」**才临时拉取真名学号（走独立鉴权接口，不随页面数据下发）。导出 Excel 里仍带真名（这是你要的）。

**学生可以负分**：教师手动扣分可以把学生扣成负数，负分只影响两点——排行榜显示、**不能使用消耗积分的功能**（目前就是发表情，余额 < 5 不让发）。参与评价 +10 照常加。

## AI 评语审核怎么配

管理后台（admin）→「全局 AI 审核兜底」，或教师端「AI 审核」页给自己单独配。

- **服务商预设是下拉的**：选中 DeepSeek / OpenAI / 通义 / Kimi / 智谱会自动填好接口地址和模型，只需要再填 API Key；选「自定义」才手动填。
- 当前全局配的是 **DeepSeek · V4.1 Flash**（模型 id `deepseek-flash`），实测一条评语约 230 tokens，一堂课几分钱。
- 填完点**「测试连接」**会真跑一次审核，直接告诉你通不通、模型返回什么。
- Key 用 **AES-256-GCM 加密**存库，接口回读只给 `sk-****e475`。
- 加密密钥来自环境变量 `APP_SECRET`（见 `.env`）。**不设的话会用数据卷里的 `.secret` 文件**——能拿到数据卷的人就能解出 Key。生产环境建议设 `APP_SECRET`。
- 换了 `APP_SECRET` 会导致已存的 Key 解不出来（表现为"未配置"），需要重新填一次。

## 本机开发

```bash
cd app
pnpm install
pnpm dev                       # 只起后端 :3000（Node 原生跑 TS，无编译步骤）
pnpm dev:web                   # 前端 Vite 热更新 :5173（自动代理 /api 到 :3000）
pnpm build                     # 构建前端到 dist/web
pnpm typecheck                 # 前端类型检查
pnpm start                     # 起服务（后端 + 前端产物，单端口）
pnpm seed                      # 灌演示数据（需干净实例）
pnpm smoke                     # 端到端测试
```

冒烟测试要打一个干净实例：

```bash
rm -rf /tmp/pr-smoke
DATA_DIR=/tmp/pr-smoke PORT=3997 node src/server/index.ts &
BASE=http://127.0.0.1:3997 node scripts/smoke.mjs
```

### 三条测试一起跑

```bash
./scripts/verify.sh
```

会起三个干净实例分别跑：

| 套件 | 数量 | 测什么 |
|---|---|---|
| `scripts/smoke.mjs` | **136 项** | 接口层：去极值算法（n=1..100 的 k 值、并列、全并列、权重全 0）、强制改密、批量导入回报、**打满才能提交**、草稿、匿名脱敏、**自评排除**、权限隔离、到期自动关闭、积分只发一次、改投不重复加分、二维码、媒体上传鉴权与非图片拦截、防目录遍历 |
| `scripts/ui-smoke.mjs` | **39 项** | 真渲染**生产打包产物**（jsdom 驱动）：登录 → 教师列表 → 去极值结果页 → 二维码 → 学生首次登录强制改密 → 深蓝未参与卡 → 9 个滑块 → 打满提交 → 结果页 → 积分 +10 → 投票提交 → 👑 最高票，并断言零渲染期报错 |
| `scripts/smoke-p1.mjs` | **75 项** | P1 接口层：评语待审→放行/驳回、改评语回待审、小眼睛接口不给真名、表情扣 5 加 1、换表情不重复、不能自评、0 分不能发、🚨5 人折叠与恢复、排行榜、手动加减分与下限、Excel 六 Sheet、AI 放行/驳回/超时/未配置 |
| `scripts/load.mjs` | **50 人并发** | 50 人同时提交 39ms 全成功、不丢分、每人积分正好 10 |

另外两套（不进 `verify.sh`，按需跑）：

| 套件 | 数量 | 说明 |
|---|---|---|
| `scripts/browser-check.mjs` | **27 项** | **真 Chromium**（Playwright）：登录、结果页、二维码真实加载、强制改密、深蓝卡、9 个滑块、打满提交、积分 +10、手机无横向滚动、零 JS 报错 |
| `scripts/browser-check-p1.mjs` | **23 项** | 真 Chromium 跑 P1：写评语→教师待审→放行→学生评语墙→另一个学生点赞+1、小眼睛显示真名、柱状图/雷达图真的画出来、点击导出真的下载到 xlsx、积分页排行榜、手机评语页无横向滚动 |

两个浏览器脚本需要 `npm i -D playwright && npx playwright install chromium`（不写进 package.json，免得生产镜像变重）。截图落在 `docs/screenshots/`。
| Node 24 兼容 | 136 项 | 用 Dockerfile 里同版本的 Node 24 跑 `smoke.mjs`，全过 |

最后两条需要 `jsdom`（devDependency，生产镜像 `--omit=dev` 不会装）。

---

## 技术选型

| 层 | 选型 | 为什么 |
|---|---|---|
| 运行时 | Node ≥ 22.6 | **原生跑 TypeScript**（类型剥离），服务端零编译步骤 |
| 数据库 | `node:sqlite`（内置） | 免原生模块编译 —— 飞牛NAS/1Panel 上装 better-sqlite3 要编译链，这是最大的部署坑 |
| 后端 | Express 4 + WAL + busy_timeout | 50 人并发读写不互相阻塞 |
| 前端 | React 18 + Vite（hash 路由，无额外路由库） | 单页，构建后 187 KB / gzip 59 KB |
| 密码 | bcryptjs | 纯 JS，免编译 |
| Excel / 图表 | exceljs / ECharts（P1） | 不用 `xlsx`(SheetJS)：npm 版停在 0.18.5，有 CVE-2023-30533 |

---

## 进度

**P0（能上课）— 已完成，本机实测通过**

- [x] 登录 / 强制改密 / 登录限流 / 角色隔离 / 数据隔离（`teacher_id` 强制过滤）
- [x] 学生组：建组、批量导入（CSV/粘贴，回报新增·已存在·格式错误）、改密重置、移出
- [x] 投票：≤10 选项、单/多选、选项配图、到期自动关、可改不可撤、票数 + 当前最高高亮
- [x] 评分：≤20 项、自定义范围/权重、匿名编号、作品图/视频上传、**打满才能提交**、草稿续填
- [x] 去极值：n<5 不去、n≥5 按 max(1,⌈n×5%⌉) 两端各剔、并列按位置、权重全 0 兜底、被剔除分数可查
- [x] 实时结果（3 秒轮询）：票数条 / 去极值明细表 / 原始均分 / 有效人数 / 未交名单
- [x] 学生端：深蓝未参与 / 浅蓝已参与、结果页（匿名）、积分
- [x] 入场二维码（教师端投屏）
- [x] 50 人并发提交压测（39ms 全过）
- [x] 界面自动化验证（jsdom 驱动生产包，39 项全过，无渲染期报错）
- [x] Docker 最终阶段等价验证：只装生产依赖（284 个包）能跑起来并过完 136 项
- [x] Docker 镜像真构建 + 真运行 + 数据持久化 + 真浏览器验证（323MB / alpine / node 24.22）
- [x] 真实 Chromium 验证（27 项，含手机 375px 排版），截图见 `docs/screenshots/`
- [ ] 微信内置浏览器没试过（Chromium 应该没问题，但微信 WebView 另说）

### 与 v2 规格书的两处偏差（有意为之）

1. **图表没用 ECharts**，改成手写 SVG（`src/web/components/Chart.tsx`）。原因：只需柱状图 + 雷达图两种简单图形，ECharts 会让包大 1MB 且多一个依赖；现在全站 212KB（gzip 67KB）。
2. **文件夹批量导出**暂为「逐个活动导出」（浏览器会连续下载多个 xlsx），没做 zip 打包 —— 服务端要引入 zip 依赖。单个活动导出已完整。

### Docker 实测抓出来的问题（已修）

**`ENV NODE_ENV=development` 污染了前端构建**：build 阶段为了让 `npm install` 装上 vite，我把 `NODE_ENV=development` 写成了全局 ENV，结果 `vite build` 也跟着跑在 development 模式，**React 打进了开发版**——镜像里 JS 是 463KB，本地正常构建只有 217KB（gzip 126KB vs 66KB）。改成只给 `npm run build` 这一条命令加 `NODE_ENV=production` 就对了。

### 真浏览器测出来的问题（已修）

**已提交的评分改不了**：学生首页点已参与的活动只会跳结果页，虽然评分页本身支持带旧分修改，但**没有入口**。已在首页卡片和结果页各加一个「修改评分 / 修改选择」按钮（仅活动进行中显示）。这个问题 jsdom 层面测不出来，只有真浏览器顺着用户路径点才会暴露。

**P1（完整功能）— 已完成，四套测试 + 真浏览器通过**

- [x] 文件夹：建/改名/删除、评价项移动归类、**归档后学生端隐藏**
- [x] 评语：每个被评对象可写一条（改评语会覆盖并重新进待审）、评审状态机 pending/approved/rejected
- [x] AI 审核：异步队列（并发 2、8 秒超时）、固定 6 类违规、失败/超时/没配一律进待审、每日预算上限、Key AES-256-GCM 加密且回读脱敏、教师私有配置优先于超管全局
- [x] 待审红点：结果页顶部提醒 + 评语 Tab
- [x] 表情：十种、发一个 −5、正面 +1（同一人同一条只加一次、换表情不重复）、不能自评、0 分不能发、每活动上限 20、🚨5 人自动折叠 + 教师一键恢复
- [x] 积分：排行榜（按班/按课程）、手动加减分（必填原因、±1000、下限 0）、流水
- [x] 图表：柱状图（多对象单项对比）+ 雷达图（单对象多维）
- [x] 小眼睛：主结果接口**只给「评委1/2/3」匿名编号**，真实姓名走独立鉴权接口；学生访问 403
- [x] Excel：六个 Sheet（概览/投票明细/原始分+极值标注/去极值结果/评语/积分+流水），**含真名学号**，导出即留痕
- [x] 热词云（已通过评语的中文 n-gram 词频）

**P2** — 大屏模式、一键备份、催办文案、登录限流细化
