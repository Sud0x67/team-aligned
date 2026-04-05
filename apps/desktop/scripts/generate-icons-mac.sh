#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
SVG_PATH="$BUILD_DIR/icon.svg"
PNG_PATH="$BUILD_DIR/icon.png"
ICONSET_DIR="$BUILD_DIR/icon.iconset"
ICNS_PATH="$BUILD_DIR/icon.icns"

rm -rf "$ICONSET_DIR" "$ICNS_PATH" "$PNG_PATH"
mkdir -p "$ICONSET_DIR"

sips -s format png "$SVG_PATH" --out "$PNG_PATH" >/dev/null

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$PNG_PATH" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  retina_size=$((size * 2))
  sips -z "$retina_size" "$retina_size" "$PNG_PATH" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"
rm -rf "$ICONSET_DIR"
