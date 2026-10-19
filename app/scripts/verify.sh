#!/usr/bin/env bash
# 一键全量验证：接口冒烟(136) + 界面冒烟(39) + 50 人并发压测
# 用法：./scripts/verify.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
}
trap cleanup EXIT

wait_up() { # $1=port $2=log
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/api/auth/me" 2>/dev/null)
    if [ "$code" = "401" ]; then return 0; fi
    sleep 0.25
  done
  echo "✗ 实例 :$1 起不来，日志："
  cat "$2"
  return 1
}

port_busy() { ss -lptnH "sport = :$1" 2>/dev/null | grep -q .; }

start() { # $1=port $2=datadir
  if port_busy "$1"; then
    echo "✗ 端口 $1 已被占用 —— 先停掉占用它的进程再跑（否则测的是别人）"
    ss -lptnH "sport = :$1"
    return 1
  fi
  rm -rf "$2"
  DATA_DIR="$2" PORT="$1" node src/server/index.ts > "/tmp/verify-$1.log" 2>&1 &
  pids+=($!)
  wait_up "$1" "/tmp/verify-$1.log"
}

fail=0

echo "==================== 1/4 接口冒烟 (端口 3991) ===================="
start 3991 /tmp/verify-smoke || exit 1
BASE=http://127.0.0.1:3991 node scripts/smoke.mjs || fail=1

echo
echo "==================== 2/4 P1 接口冒烟 (端口 3994) ===================="
start 3994 /tmp/verify-p1 || exit 1
BASE=http://127.0.0.1:3994 node scripts/seed.mjs > /tmp/verify-seed-p1.log 2>&1 || { echo "种子数据失败"; cat /tmp/verify-seed-p1.log; exit 1; }
BASE=http://127.0.0.1:3994 node scripts/smoke-p1.mjs || fail=1

echo
echo "==================== 3/4 界面冒烟 (端口 3990) ===================="
start 3990 /tmp/verify-ui || exit 1
BASE=http://127.0.0.1:3990 node scripts/seed.mjs > /tmp/verify-seed.log 2>&1 || { echo "种子数据失败"; cat /tmp/verify-seed.log; exit 1; }
BASE=http://127.0.0.1:3990 node scripts/ui-smoke.mjs || fail=1

echo
echo "==================== 4/4 并发压测 50 人 (端口 3992) ===================="
start 3992 /tmp/verify-load || exit 1
BASE=http://127.0.0.1:3992 node scripts/load.mjs || fail=1

echo
if [ "$fail" = "0" ]; then
  echo "✅ 全部通过"
else
  echo "❌ 有失败项"
fi
exit "$fail"
