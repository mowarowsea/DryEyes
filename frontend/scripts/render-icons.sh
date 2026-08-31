#!/usr/bin/env bash
# public/favicon.svg から PNG のアイコン一式（PWA / apple-touch / ファビコン）を書き出す。
#
#   bash scripts/render-icons.sh
#
# 絵柄の原本はあくまで favicon.svg 側。角丸の有無と絵柄の縮尺だけを CSS で
# 上書きして書き出しているので、意匠を変えるときは SVG だけ直せばよい。
# ラスタライザは headless の Chromium（Edge か Chrome）を使う。追加の依存を
# 増やさずに済み、ブラウザが実際に表示する見た目とずれないため。
set -euo pipefail

cd "$(dirname "$0")/.."
SVG=public/favicon.svg
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

BROWSER=${BROWSER:-}
if [ -z "$BROWSER" ]; then
  for c in \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "$(command -v google-chrome || true)" \
    "$(command -v chromium || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && BROWSER=$c && break
  done
fi
[ -n "$BROWSER" ] || { echo "Chromium 系のブラウザが見つからない。BROWSER=<path> で指定して" >&2; exit 1; }

# $1=出力 $2=書き出しサイズ $3=SVG に足す CSS
render() {
  local out=$1 size=$2 css=$3
  local html="$TMP/wrap.html" udd="$TMP/udd-$(basename "$out" .png)"
  {
    printf '<html><head><style>html,body{margin:0;padding:0;background:transparent}'
    printf 'svg{display:block;width:%spx;height:%spx}%s</style></head><body>\n' "$size" "$size" "$css"
    cat "$SVG"
    printf '\n</body></html>\n'
  } > "$html"

  local win_out win_html win_udd
  if command -v cygpath >/dev/null 2>&1; then
    win_out=$(cygpath -w "$(realpath -m "$out")"); win_html=$(cygpath -w "$html"); win_udd=$(cygpath -w "$udd")
  else
    win_out=$out; win_html=$html; win_udd=$udd
  fi

  rm -f "$out"
  "$BROWSER" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$win_udd" --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size="$size,$size" \
    --screenshot="$win_out" "$win_html" >/dev/null 2>&1 || true

  # ヘッドレスは PNG を非同期に書き出すことがあるので、サイズが落ち着くまで待つ
  local prev="" cur stable=0
  for _ in $(seq 1 40); do
    timeout 0.3 tail -f /dev/null >/dev/null 2>&1 || true
    cur=$(stat -c%s "$out" 2>/dev/null || echo "")
    if [ -n "$cur" ] && [ "$cur" = "$prev" ]; then
      stable=$((stable + 1)); [ $stable -ge 2 ] && break
    else
      stable=0
    fi
    prev=$cur
  done
  [ -s "$out" ] || { echo "書き出しに失敗: $out" >&2; exit 1; }
  echo "$out ($size)"
}

# 角丸の板（ブラウザのファビコンと PWA の any アイコン）
render public/icons/icon-512.png 512 ''
render public/icons/icon-192.png 192 ''
render public/favicon-32.png 32 ''
# iOS は自前で角を丸めるので、板は四角のまま渡す
render public/icons/apple-touch-icon.png 180 '#plate{rx:0}'
# maskable は外周 20% が削られうる。板を四角にし、絵柄を安全圏まで縮める
render public/icons/icon-maskable-512.png 512 '#plate{rx:0}#art{transform-origin:256px 256px;transform:scale(0.76)}'
