#!/usr/bin/env bash
# dsh-project-kanban 端到端验证（无 LLM key）：
# 1) 创建临时 profile 并安装本地包（tarball 或目录）
# 2) 挂载 web-app 组合（真实浏览器形态）
# 3) 运行 tests/verify.mjs 断言工具 schema + HTTP 全流程
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_BIN="${DSH_BIN:-node /Users/struy/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js}"
TEST_HOME="$(mktemp -d /tmp/dsh-kanban-verify.XXXXXX)"
PORT="${KANBAN_TEST_PORT:-3199}"

cleanup() { rm -rf "$TEST_HOME"; }
trap cleanup EXIT

echo "== 1/4 安装到临时 profile =="
export DSH_HOME="$TEST_HOME"
# shellcheck disable=SC2086
$DSH_BIN plugin --profile it add "$ROOT" >/dev/null 2>&1 || $DSH_BIN plugin --profile it add "$ROOT/dsh-project-kanban-"*.tgz >/dev/null

echo "== 2/4 挂载 web-app 组合 =="
python3 - <<PYEOF
import json, glob
pkg = json.load(open("$TEST_HOME/profiles/it/package.json"))
pkg["dsh"]["profile"]["bundles"] = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-project-kanban"]
json.dump(pkg, open("$TEST_HOME/profiles/it/package.json", "w"), ensure_ascii=False, indent=2)
PYEOF
cat > "$TEST_HOME/port.yml" <<YML
- id: webserver
  config:
    host: 127.0.0.1
    port: $PORT
YML

echo "== 3/4 组合验证 =="
$DSH_BIN --profile it --dump-config | grep -q "dsh-project-kanban" && echo "layer OK"

echo "== 4/4 功能验证 =="
cd "$TEST_HOME/profiles/it"
cp "$ROOT/tests/verify.mjs" ./verify.mjs
KANBAN_TEST_PROFILE=it KANBAN_TEST_PORT="$PORT" KANBAN_TEST_PATCH="$TEST_HOME/port.yml" \
  DSH_HOME="$TEST_HOME" DSH_TELEMETRY_DISABLED=1 node ./verify.mjs
