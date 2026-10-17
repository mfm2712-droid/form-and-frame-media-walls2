#!/usr/bin/env bash
# Assemble docs/master/vercel-project/public/ from the committed Live Master + PDF.
# Run from anywhere. Makes no network requests, deploys nothing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
master="$here/.."
out="$here/public"
rm -rf "$out"; mkdir -p "$out"
cp -R "$master/live/." "$out/"
cp "$master/FORM_AND_FRAME_MASTER_BOOK.pdf" "$out/FORM_AND_FRAME_MASTER_BOOK.pdf"
# robots.txt: belt and braces (the real protection is Deployment Protection, see README)
printf 'User-agent: *\nDisallow: /\n' > "$out/robots.txt"
# Never ship the hosting note's claim "not hosted anywhere" unchanged: keep it, it is still true until Mark deploys.
echo "Assembled $out"; find "$out" -type f | wc -l
