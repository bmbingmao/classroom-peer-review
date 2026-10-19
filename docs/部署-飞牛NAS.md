# 部署到飞牛 NAS / 群晖 / 任意 Linux

> 现成镜像 + 一键脚本，**不需要 NAS 联网**（镜像已经打好，直接导入）。
> 整个 `deploy/` 目录就是全部东西，打包版：`peer-review-deploy.tar.gz`（约 71MB）。

---

## 前置检查（1 分钟）

NAS 上 `:3000` 已经被占用了（nginx 返回 401），所以这套用 **3100** 端口。

需要确认的两件事：

1. **架构是 x86_64**（`uname -m`）。飞牛绝大多数设备都是 x86_64；如果是 `aarch64`，这份镜像跑不了，要走「构建版说明.md」。
2. **SSH 已经打开**：飞牛控制台 → 设置 → 终端与 SSH → 打开。SSH 用户名就是你的飞牛登录账号，密码同一个（root 一般不让直接密码登录，用普通账号 + `sudo`）。

---

## 方式一：SSH 推过去（推荐，3 条命令）

在**这台开发机**上执行：

```bash
# 1. 把安装包传到 NAS（会问密码）
scp peer-review-deploy.tar.gz 你的账号@NAS_IP:~/

# 2. 登上去
ssh 你的账号@NAS_IP

# 3. 解包并安装
mkdir -p ~/peer-review && tar xzf ~/peer-review-deploy.tar.gz -C ~/peer-review
cd ~/peer-review && sudo bash install.sh
```

`install.sh` 会：导入镜像 → 生成 `.env`（带随机 `APP_SECRET`）→ 提示你改密码 → 再跑一次就起容器。

**第一次跑会停下**，让你改 `.env` 里的 `ADMIN_PASSWORD`：

```bash
nano ~/peer-review/.env     # 改 ADMIN_PASSWORD
sudo bash ~/peer-review/install.sh   # 再跑一次
```

完成后浏览器打开：**http://NAS_IP:3100**

---

## 方式二：只用网页（不碰命令行）

如果不想开 SSH：

1. 飞牛控制台 → **文件管理** → 把 `peer-review-deploy.tar.gz` 上传到任意目录
2. 解压（飞牛文件管理器支持解压 tar.gz）
3. 控制台 → **Docker**（应用中心的容器管理）→ **镜像** → **导入** → 选 `peer-review-image.tar`（需要先把 `.tar.gz` 解压出 `.tar`）
4. **容器 → 新建**，填：
   - 镜像：`peer-review:latest`
   - 端口：宿主机 `3100` → 容器 `3000`
   - 环境变量：`TZ=Asia/Shanghai`、`PORT=3000`、`DATA_DIR=/data`、`ADMIN_USERNAME=admin`、`ADMIN_PASSWORD=你的密码`、`COOKIE_SECURE=false`、`APP_SECRET=一串随机字符`
   - 存储：新建卷挂到 `/data`
   - 重启策略：`unless-stopped`

> 网页方式容易在环境变量上漏东西（尤其 `DATA_DIR=/data` 和端口映射），漏了就会反复重启。**能用 SSH 就别用网页。**

---

## 部署之后

| 事项 | 做法 |
|---|---|
| 看状态 | `sudo docker compose ps`（healthy 就正常） |
| 看日志 | `sudo docker compose logs -f app` |
| 重启 | `sudo docker compose restart` |
| 停止 | `sudo docker compose down`（数据保留） |
| 备份 | `sudo docker run --rm -v peer-review_peerdata:/d -v $PWD:/b alpine tar czf /b/backup-$(date +%F).tgz -C /d .` |
| 升级 | 传新镜像 → `gunzip -c 新镜像.tar.gz \| sudo docker load` → `sudo docker compose up -d` |

**数据在哪**：命名卷 `peer-review_peerdata`，里面是 `app.db` + `uploads/`。
**别**把这个卷挂到 SMB/NFS 共享目录——SQLite 的 WAL 在网络文件系统上会打不开库。

---

## 常见问题

**容器起来又退出？**
`docker compose logs app` 看日志。最常见是 `DATA_DIR` 没设或卷没挂上。

**浏览器打不开？**
- 确认 `docker compose ps` 里端口映射是 `0.0.0.0:3100->3000/tcp`
- 飞牛自带防火墙/安全设置里确认 3100 放行（内网一般默认放行）

**登录后立刻跳回登录页？**
`COOKIE_SECURE` 必须 `false`（局域网是 HTTP）。

**AI 审核不生效？**
进管理后台 → 全局 AI 审核兜底 → 下拉选 DeepSeek → 填 Key → 点「测试连接」。没配也能用，就是所有评语进待审由老师手动放行。

**换机器/重装后 AI Key 失效？**
`.env` 里的 `APP_SECRET` 变了。保持它不变就不会失效。

---


## 怎么自己打这个离线包

在任意一台能构建的机器上：

```bash
cd app
docker compose build
docker save <镜像名>:latest | gzip -1 > peer-review-image.tar.gz   # 约 71MB
```

然后和 `docker-compose.yml`、`install.sh`、`.env.example` 一起打成 tar 传到 NAS 即可。
NAS 端只做 `gunzip -c | docker load`，**全程不需要访问 Docker Hub**。
