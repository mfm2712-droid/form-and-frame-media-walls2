#!/usr/bin/env bash
# Signed-out check for the private Master docs deployment.
# Usage: bash scripts/master-docs/check-private.sh https://<docs-project>.vercel.app
# PASS for a path = HTTP 401/403, or a 3xx whose Location is a Vercel login/SSO page, and no Master content in the body.
# Any 200 (or a 3xx elsewhere) = FAIL. Read-only: only GET/HEAD requests, no credentials sent.
set -u
base="${1:-}"
[ -n "$base" ] || { echo "usage: $0 <base-url, e.g. https://form-and-frame-master-docs.vercel.app>"; exit 2; }
base="${base%/}"
case "$base" in https://*) ;; *) echo "base URL must start with https://"; exit 2;; esac
PATHS=(
  / /index.html /HOSTING.txt /robots.txt /FORM_AND_FRAME_MASTER_BOOK.pdf
  /assets/diagrams/01-platform-map.svg /assets/diagrams/03-supabase-components.svg
  /assets/screenshots/public/fold-desktop-1440.webp
  /assets/screenshots/staff-demo/desktop-1440-today-plan.webp
  /search-index.json /vercel.json /.git/config /does-not-exist
)
ua="Mozilla/5.0 (X11; Linux x86_64) check-private"
fail=0; n=0
check() { # method path
  local m="$1" p="$2" tmp code loc leaked
  tmp="$(mktemp)"
  if [ "$m" = HEAD ]; then
    out="$(curl -s -I -o "$tmp" -w '%{http_code} %{redirect_url}' --max-time 20 -A "$ua" "$base$p")"
  else
    out="$(curl -s -o "$tmp" -w '%{http_code} %{redirect_url}' --max-time 20 -A "$ua" "$base$p")"
  fi
  code="${out%% *}"; loc="${out#* }"
  leaked=0
  grep -q -a -E "Master Book|FORM_AND_FRAME_LIVE_MASTER|%PDF-" "$tmp" 2>/dev/null && leaked=1
  rm -f "$tmp"
  n=$((n+1))
  if [ "$leaked" = 1 ]; then echo "FAIL  $m $p -> $code (Master content in body)"; fail=$((fail+1)); return; fi
  case "$code" in
    401|403) echo "ok    $m $p -> $code" ;;
    301|302|303|307|308)
      case "$loc" in
        https://vercel.com/login*|https://vercel.com/sso-api*|https://vercel.com/api/*) echo "ok    $m $p -> $code $loc" ;;
        *) echo "FAIL  $m $p -> $code $loc (redirect not to Vercel login)"; fail=$((fail+1)) ;;
      esac ;;
    404) echo "WARN  $m $p -> 404 (path does not exist or is not behind protection; confirm 401 on a real path)" ;;
    000) echo "ERROR $m $p -> no response"; fail=$((fail+1)) ;;
    *) echo "FAIL  $m $p -> $code (expected 401 or redirect to Vercel login)"; fail=$((fail+1)) ;;
  esac
}
for p in "${PATHS[@]}"; do check GET "$p"; check HEAD "$p"; done
echo "checked $n requests against $base, failures: $fail"
[ "$fail" -eq 0 ] && echo "RESULT: PASS (signed-out visitors get no content)" || echo "RESULT: FAIL - turn the deployment off and fix Deployment Protection"
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
