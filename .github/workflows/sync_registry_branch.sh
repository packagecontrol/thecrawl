#!/usr/bin/env bash
set -euo pipefail

UV_BINARY="${UV_BINARY:-uv}"
REGISTRY_DIR="${1:-./.the-registry}"
OLD="${REGISTRY_DIR%/}/registry.json"
NEW="${2:-./wrk/registry.json}"

if cmp -s "$OLD" "$NEW"; then
  echo "No registry changes."
  exit 0
fi

MSG=""
DESC_ERR="$(mktemp)"
if ! MSG="$("$UV_BINARY" run -m scripts.describe_registry_changes -a "$OLD" -b "$NEW" 2>"$DESC_ERR")"; then
  DESC_ERR_CONTENT="$(cat "$DESC_ERR")"
  echo "::warning::describe_registry_changes failed; using fallback subject"
  if [ -n "$DESC_ERR_CONTENT" ]; then
    echo "::notice::describe_registry_changes stderr: $(head -n 1 "$DESC_ERR")"
    MSG="$(cat <<EOF
Update registry.json

---
describe_registry_changes.py raised

$DESC_ERR_CONTENT
EOF
)"
  else
    MSG="Update registry.json"
  fi
fi
rm -f "$DESC_ERR"

if [ "$MSG" = "Same." ] || [ -z "$MSG" ]; then
  echo "::notice::describe_registry_changes did not recognize a real registry diff; using fallback subject (raw='${MSG:-<empty>}')"
  MSG="Update registry.json"
fi

cp "$NEW" "$OLD"

git -C "$REGISTRY_DIR" config user.name "github-actions[bot]"
git -C "$REGISTRY_DIR" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$REGISTRY_DIR" add registry.json
git -C "$REGISTRY_DIR" commit -F - <<MSG
$MSG
MSG

git -C "$REGISTRY_DIR" push origin the-registry
