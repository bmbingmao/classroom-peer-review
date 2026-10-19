# 课堂互评 / 投票评分系统

> 局域网里跑的课堂互评工具：老师发起评分或投票，学生手机扫码参与，实时出分，一键导出 Excel。
> **单机 Docker，50 人规模，中文界面，装在自己电脑或 NAS 上。**

[![Docker](https://img.shields.io/badge/deploy-docker%20compose-2496ED?logo=docker&logoColor=white)](#快速开始)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.6-339933?logo=node.js&logoColor=white)](#技术栈)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

---

## 它解决什么问题

课堂上的作品互评，老师通常这么做：让全班传阅作品、纸笔打分、课后手工算分。三四十份评分，去极值、算加权、查谁没交，一套下来两小时。

这个系统把这几步搬到网页上：

- **学生扫码就进**（不用装 App、不用注册）
- **打满才能提交**（逼着你把每一项都看完）
- **自动去极值**（去掉最高最低分再平均，算法写在界面上，可追溯）
- **匿名对匿名**（学生之间看不到谁评的谁，老师点「小眼睛」才能看真名）
- **当场出结果**（投屏就能看票数、均分、雷达图）

没有云服务、没有账号体系、不联网也能跑（AI 评语审核除外，那是可选功能）。

---

## 截图

| 教师端 · 去极值明细 | 教师端 · 图表 |
|---|---|
| ![结果页](docs/screenshots/03-result.png) | ![图表](docs/screenshots/04-charts.png) |

| 学生端 · 活动列表 | 学生端 · 打分（手机） |
|---|---|
| ![学生首页](docs/screenshots/07-mobile-home.png) | ![手机打分](docs/screenshots/08-mobile-score.png) |

更多截图在 [`docs/screenshots/`](docs/screenshots/)。

---

## 功能

**教师端**
- 学生组管理，粘贴或 CSV 批量导入（学号+姓名），初始密码=学号，首次登录强制改密
- 发起**投票**（≤10 选项、单选/多选、定时关闭、可选配图）
- 发起**评分**（≤20 个评分项、自定义分值区间与权重、指定被评对象、上传作品图/视频）
- 实时结果：去极值均分、原始均分、有效人数、被剔除的分数、柱状图、雷达图
- 评语墙：AI 审核 → 待审队列 → 放行/驳回；热词云
- 小眼睛：一键看真实身份（走独立鉴权接口，默认不下发）
- 积分：手动加减分（可以扣成负数）、排行榜
- 导出 Excel（6 个 Sheet，含原始分与极值标注）
- 文件夹归档、入场二维码

**学生端**
- 扫码 → 学号登录 → 改密码
- 深蓝卡=还没参与，浅蓝卡=已参与
- 打分（滑块+数字，自动存草稿）、写评语、发表情
- 匿名看结果、看评语墙、看积分与班级排行榜

**管理端**
- 开通/禁用教师账号
- 全局 AI 审核兜底配置（服务商下拉 + 测试连接）

---

## 快速开始

```bash
git clone https://github.com/bmbingmao/classroom-peer-review.git
cd classroom-peer-review/app
cp .env.example .env      # 改 ADMIN_PASSWORD
docker compose up -d --build
```

浏览器打开 `http://<本机局域网IP>:3000`，用 `.env` 里的 `admin` 账号登录（首次登录强制改密）。

**学生入场**：老师发起活动后点「入场二维码」，投屏让学生扫。

### ⚠️ 三个必看的坑

1. **`COOKIE_SECURE` 必须是 `false`**（局域网是 HTTP）。设成 true 会表现为"登录后跳回登录页"。
2. **数据卷别挂到 SMB/NFS 共享目录**。SQLite 的 WAL 在网络文件系统上会直接打不开库。用命名卷或 NAS 本地盘。
3. **`ADMIN_PASSWORD` 只在首次启动生效**（库里还没有 admin 时）。

### Docker Hub 拉不动？

国内网络经常拉不到基础镜像，配镜像源：

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{ "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run", "https://dockerproxy.net"] }
EOF
sudo systemctl restart docker
```

---

## 部署到 NAS（飞牛 / 群晖 / 1Panel）

见 [`docs/部署-飞牛NAS.md`](docs/部署-飞牛NAS.md)，含：
- 在开发机上打包镜像 → scp 到 NAS 导入（**NAS 完全不用连 Docker Hub**）
- 端口冲突、数据卷、备份、升级、常见故障

---

## 技术栈与设计取舍

| 层 | 选型 | 为什么 |
|---|---|---|
| 运行时 | Node ≥ 22.6 | **原生跑 TypeScript**（类型剥离），服务端零编译步骤 |
| 数据库 | `node:sqlite`（内置） | 免原生模块编译 —— NAS 上装 better-sqlite3 要编译链，这是最大的部署坑 |
| 后端 | Express 4 + WAL + `busy_timeout` | 50 人并发读写不互相阻塞 |
| 前端 | React 18 + Vite | 单页，hash 路由，无额外路由库 |
| 图表 | 手写 SVG | 只需柱状图+雷达图，ECharts 要多 1MB |
| Excel | exceljs | `xlsx`(SheetJS) 的 npm 版停在 0.18.5，有已知 CVE |
| 密码 | bcryptjs | 纯 JS，免编译 |
| AI 审核 | OpenAI 兼容接口 + 异步队列 | 提交立即返回，8 秒超时，失败一律进待审，不阻塞学生 |

**几个刻意的设计**

- **打满才能提交**：服务端二次校验，缺一格返回 400 并给出缺口列表。
- **草稿与正式分分离**：草稿存 `score_drafts`，正式分只在提交时原子写入，避免半截数据污染统计。
- **去极值排序键 `(分数, 学号)`**：保证同分时剔除对象稳定，重算结果可复现。
- **匿名是"不记录"的反面**：身份照常记录（发积分、小眼睛要用），但**接口不下发**，学生抓包也看不到。
- **AI 审核异步化**：同步调模型会让提交卡 5~10 秒；现在是提交即返回、后台判。

---

## 测试

```bash
cd app
./scripts/verify.sh   # 一条命令跑完接口+界面+并发三套
```

| 套件 | 数量 | 覆盖 |
|---|---|---|
| 接口冒烟 | 136 项 | 去极值算法（n=1..100 的 k 值、并列、权重全 0）、强制改密、批量导入、打满校验、草稿、匿名脱敏、自评排除、权限隔离、到期自动关闭、积分只发一次、改投不重复加分、二维码、媒体上传鉴权、防目录遍历 |
| P1 接口 | 80 项 | 评语状态机、小眼睛、表情扣分/加分/防刷/🚨折叠、负分、排行榜、Excel 六 Sheet、AI 放行/驳回/超时/未配置 |
| 界面冒烟 | 39 项 | jsdom 渲染生产包：登录 → 结果页 → 二维码 → 强制改密 → 深蓝卡 → 滑块 → 提交 → 投票 |
| 并发 | 50 人 | 同时提交 39ms 全过，不丢分 |

真浏览器验证（Playwright，需自装）另有 27 + 23 项。

---

## 适用范围与免责

- 定位是**个人/科组自用的教学工具**，不是产品级 SaaS。
- 面向**局域网**（教室、机房）。**未做公网加固**——要放公网请自己加 HTTPS、反向代理和限流。
- 多教师数据隔离做了（每条 SQL 带 `teacher_id`），但没有审计日志、没有备份策略（给了备份命令）。
- 不承诺响应 issue，但欢迎提。

---

## License

[MIT](LICENSE)
