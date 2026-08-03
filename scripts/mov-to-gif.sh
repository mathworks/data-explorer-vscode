#!/bin/sh
# Convert a screen recording (.mov/.mp4) to an optimized GIF for the README.
#
# Usage:
#   scripts/mov-to-gif.sh INPUT.mov [OUTPUT.gif] [FPS] [WIDTH]
#
# Defaults: OUTPUT = media/screenshots/demo.gif, FPS = 12, WIDTH = 1000px.
# Uses a two-pass palette (palettegen/paletteuse) for clean color + small size.
#
# Requires ffmpeg on PATH (installed at ~/.local/bin/ffmpeg).

set -e

FFMPEG="${FFMPEG:-$HOME/.local/bin/ffmpeg}"

IN="$1"
OUT="${2:-media/screenshots/demo.gif}"
FPS="${3:-12}"
WIDTH="${4:-1000}"

if [ -z "$IN" ] || [ ! -f "$IN" ]; then
  echo "error: input file not found. usage: $0 INPUT.mov [OUTPUT.gif] [FPS] [WIDTH]" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
PALETTE="$(dirname "$OUT")/.palette.png"

FILTERS="fps=${FPS},scale=${WIDTH}:-1:flags=lanczos"

echo "pass 1/2: generating palette..."
"$FFMPEG" -y -i "$IN" -vf "${FILTERS},palettegen=stats_mode=diff" "$PALETTE"

echo "pass 2/2: encoding gif -> $OUT ..."
"$FFMPEG" -y -i "$IN" -i "$PALETTE" \
  -lavfi "${FILTERS} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  "$OUT"

rm -f "$PALETTE"

SIZE=$(du -h "$OUT" | cut -f1)
echo "done: $OUT ($SIZE)"
echo "tip: if it's over ~5 MB for the README, re-run with a lower FPS or WIDTH, e.g.:"
echo "  $0 \"$IN\" \"$OUT\" 10 900"
