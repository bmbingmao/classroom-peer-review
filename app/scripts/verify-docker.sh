#!/usr/bin/env bash
# 一键验证 Docker 镜像：构建 → 起容器 → 健康检查 → 跑接口冒烟 → 验证数据持久化 → 清理
# 用法：./scripts/verify-docker.sh [端口，默认 3100]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORT="${1:-3100}"
PROJECT="peer-review-verify"
fail=0

step() { echo; echo "==================== $* ===================="; }
ok() { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; fail=1; }

step "0. 检查 docker"
if ! docker info >/dev/null 2>&1; then
  echo "docker 不可用（需要 sudo 或把用户加进 docker 组）"
  exit 1
fi
docker version --format '  docker {{.Server.Version}}' 2>/dev/null | head -1

step "1. 构建镜像"
if docker compose -p "$PROJECT" build 2>&1 | tail -5; then
  ok "镜像构建成功"
else
  bad "镜像构建失败"
  exit 1
fi
IMG=$(docker compose -p "$PROJECT" config --images 2>/dev/null | head -1)
echo "  镜像：$IMG"
docker image ls "$IMG" --format '  大小：{{.Size}}'

step "2. 起容器（端口 $PORT）"
PORT="$PORT" docker compose -p "$PROJECT" up -d 2>&1 | tail -3
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/me" 2>/dev/null)
  [ "$code" = "401" ] && break
  sleep 1
done
if [ "$code" = "401" ]; then ok "容器起来了，接口有响应"; else bad "容器没起来（code=$code）"; docker compose -p "$PROJECT" logs --tail 30; exit 1; fi

sleep 3
STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose -p "$PROJECT" ps -q app)" 2>/dev/null)
[ "$STATUS" = "healthy" ] && ok "健康检查通过（healthy）" || echo "  · 健康检查状态：$STATUS（可能要再等几秒）"

step "3. 容器内环境"
docker compose -p "$PROJECT" exec -T app node -e "
console.log('  node', process.version);
console.log('  TZ', process.env.TZ, '| 容器时间', new Date().toLocaleString('zh-CN'));
console.log('  DATA_DIR', process.env.DATA_DIR);
" 2>/dev/null || echo "  （exec 失败，跳过）"
docker compose -p "$PROJECT" exec -T app sh -c 'ls -la "$DATA_DIR" | head -5' 2>/dev/null

step "4. 页面与接口冒烟"
curl -s "http://127.0.0.1:$PORT/" | grep -q '<div id="root">' && ok "首页 HTML 正常" || bad "首页异常"
BASE="http://127.0.0.1:$PORT" node scripts/smoke.mjs > /tmp/docker-smoke.log 2>&1
if [ $? -eq 0 ]; then ok "接口冒烟 136 项全过"; else bad "接口冒烟失败"; tail -20 /tmp/docker-smoke.log; fi

step "5. 数据持久化（重启容器）"
docker compose -p "$PROJECT" restart app >/dev/null 2>&1
sleep 6
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/me")
[ "$code" = "401" ] && ok "重启后服务恢复" || bad "重启后不可用（code=$code）"
# 冒烟已经把 admin 密码改成 admin6666，能登录说明数据还在
LOGIN=$(curl -s -X POST "http://127.0.0.1:$PORT/api/auth/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"admin6666"}' -o /dev/null -w '%{http_code}')
[ "$LOGIN" = "200" ] && ok "重启后数据还在（admin 新密码仍可登录）" || bad "重启后数据丢了（login=$LOGIN）"

step "6. 清理"
docker compose -p "$PROJECT" down -v >/dev/null 2>&1 && ok "容器与测试卷已清理（镜像保留）"
echo "  重新起：cd $(pwd) && PORT=3000 docker compose up -d"

echo
if [ "$fail" = "0" ]; then echo "✅ Docker 构建与运行验证全部通过"; else echo "❌ 有失败项"; fi
exit "$fail"
