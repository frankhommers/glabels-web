#!/usr/bin/env bash
# Copies the template database out of the built renderer image into vendor/,
# so the backend and the tests can reach it outside the container.
set -euo pipefail

IMAGE="${1:-glabels-web/renderer:dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/glabels-qt"

container="$(docker create "$IMAGE")"
trap 'docker rm -f "$container" >/dev/null' EXIT

rm -rf "$DEST"
mkdir -p "$DEST"
docker cp "$container:/opt/glabels/share/glabels-qt/templates" "$DEST/templates"
docker cp "$container:/opt/glabels/share/glabels-web/upstream-commit.txt" "$DEST/upstream-commit.txt"
docker cp "$container:/opt/glabels/share/glabels-web/build-config.txt" "$DEST/build-config.txt"
# The bundled fonts, so during development the browser can show the same fonts
# the renderer uses.
docker cp "$container:/usr/share/fonts" "$DEST/fonts"

echo "Template database in $DEST/templates ($(ls "$DEST/templates" | wc -l | tr -d ' ') files)"
echo "Fonts in $DEST/fonts ($(find "$DEST/fonts" -name '*.ttf' -o -name '*.otf' | wc -l | tr -d ' ') files)"
echo "Upstream commit: $(cat "$DEST/upstream-commit.txt")"
