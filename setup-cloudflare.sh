#!/usr/bin/env bash
# Bootstraps JobHunt into a Cloudflare account. Idempotent: safe to re-run.
#
# Usage:
#   1. Put your token in app/.env   (see .env.example)
#   2. bash setup-cloudflare.sh
#
# Creates: D1 database "jobhunt" and a KV namespace for OAuth state, then writes the
# resource IDs into mcp/wrangler.jsonc and dash/wrangler.jsonc and applies the migrations.
# Documents are stored as BLOBs in D1, so there is no object store to set up.

set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set."
  echo "Create app/.env from .env.example, then re-run."
  exit 1
fi

W="./node_modules/.bin/wrangler"
[ -x "$W" ] || { echo "Run npm install first."; exit 1; }

# The filled-in worker configs are not in git (they hold your ids, address and hostnames).
for c in mcp dash; do
  [ -f "$c/wrangler.jsonc" ] || { cp "$c/wrangler.example.jsonc" "$c/wrangler.jsonc"; echo "created $c/wrangler.jsonc from the example"; }
done

echo "== account =="
$W whoami 2>&1 | grep -iE "email|Account Name|Account ID" | head -4 || true

# ---- D1 ----
DB_ID=$($W d1 info jobhunt --json 2>/dev/null | python3 -c \
  'import json,sys
try: print(json.load(sys.stdin).get("uuid",""))
except Exception: print("")' || true)

if [ -z "$DB_ID" ]; then
  echo "== creating D1 database 'jobhunt' =="
  $W d1 create jobhunt >/dev/null
  DB_ID=$($W d1 info jobhunt --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["uuid"])')
fi
echo "D1 jobhunt: $DB_ID"

# ---- KV (OAuth state) ----
KV_ID=$($W kv namespace list 2>/dev/null | python3 -c \
  'import json,sys
try:
    for n in json.load(sys.stdin):
        if n.get("title","").endswith("jobhunt-oauth"): print(n["id"]); break
except Exception: pass' || true)

if [ -z "$KV_ID" ]; then
  echo "== creating KV namespace 'jobhunt-oauth' =="
  $W kv namespace create jobhunt-oauth >/dev/null
  KV_ID=$($W kv namespace list | python3 -c \
    'import json,sys
for n in json.load(sys.stdin):
    if n.get("title","").endswith("jobhunt-oauth"): print(n["id"]); break')
fi
echo "KV jobhunt-oauth: $KV_ID"

# ---- wire the ids into the worker configs ----
python3 - "$DB_ID" "$KV_ID" <<'PY'
import re, sys, pathlib
db_id, kv_id = sys.argv[1], sys.argv[2]
for p in ("mcp/wrangler.jsonc", "dash/wrangler.jsonc"):
    f = pathlib.Path(p)
    if not f.exists():
        continue
    s = f.read_text()
    s = re.sub(r'("database_id":\s*")[^"]*(")', r'\g<1>' + db_id + r'\g<2>', s)
    s = re.sub(r'("binding":\s*"OAUTH_KV",\s*"id":\s*")[^"]*(")', r'\g<1>' + kv_id + r'\g<2>', s)
    f.write_text(s)
    print(f"wired {p}")
PY

echo "== applying database migrations =="
$W d1 migrations apply jobhunt --remote --config mcp/wrangler.jsonc

echo
echo "Done. Next:"
echo "  1. Edit mcp/wrangler.jsonc and dash/wrangler.jsonc: ALLOWED_EMAIL (the only address that"
echo "     may sign in), GOOGLE_CLIENT_ID, and the PUBLIC_DASH_URL / PUBLIC_MCP_URL hostnames."
echo "  2. Set the secrets on BOTH workers:"
echo "       \$W secret put SESSION_SECRET --config mcp/wrangler.jsonc        # any long random string"
echo "       \$W secret put GOOGLE_CLIENT_SECRET --config mcp/wrangler.jsonc"
echo "       (repeat with --config dash/wrangler.jsonc; APIFY_TOKEN on mcp only, if you use it)"
echo "  3. npm run deploy:mcp && npm run deploy:dash"
echo "  4. Open the dashboard, sign in, and follow Setup, Connect Claude."
