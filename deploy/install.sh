#!/usr/bin/env bash
# 飞牛 NAS 一键安装：导入镜像 → 准备配置 → 起容器
# 用法：把整个 deploy 目录传到 NAS 上，然后  bash install.sh
set -uo pipefail
cd "$(dirname "$0")" || exit 1

# 有些系统上 docker 需要 sudo
SUDO=""
if [ "$(id -u)" -ne 0 ] && ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "docker 不可用：请用 root 运行，或把当前用户加入 docker 组"
    exit 1
  fi
fi
run() { if [ -n "$SUDO" ]; then sudo "$@"; else "$@"; fi; }

echo "=== 1. 检查架构 ==="
ARCH=$(uname -m)
echo "  本机架构：$ARCH"
if [ "$ARCH" != "x86_64" ]; then
  echo "  ⚠️ 这个镜像是 x86_64 的，当前是 $ARCH，跑不了。"
  echo "     请在 NAS 上从源码构建：docker compose -f docker-compose.build.yml up -d --build"
  exit 1
fi

echo "=== 2. 导入镜像 ==="
if [ -f peer-review-image.tar.gz ]; then
  gunzip -c peer-review-image.tar.gz | run docker load
else
  echo "  找不到 peer-review-image.tar.gz"
  exit 1
fi
run docker images peer-review:latest --format '  {{.Repository}}:{{.Tag}} {{.Size}}'

echo "=== 3. 准备配置 ==="
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)
  sed -i "s|^APP_SECRET=.*|APP_SECRET=$SECRET|" .env
  echo "  已生成 .env（含随机 APP_SECRET）"
  echo "  ⚠️ 请修改 .env 里的 ADMIN_PASSWORD，再重新执行本脚本"
  cat .env
  exit 0
fi
echo "  使用现有 .env"
grep -E '^(PORT|ADMIN_USERNAME)=' .env || true

echo "=== 4. 起容器 ==="
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)
run docker compose up -d
sleep 4
run docker compose ps

echo
echo "=== 完成 ==="
echo "  访问：http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT:-3100}"
echo "  账号：见 .env 里的 ADMIN_USERNAME / ADMIN_PASSWORD（首次登录要改密）"
echo "  备查：docker compose logs -f app"
