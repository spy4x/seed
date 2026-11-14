#!/bin/sh
# Writes the SPA's /config.json when the container starts, from the variables listed in the allow
# list (public-env.allow) and from nothing else. nginx's entrypoint runs it before nginx starts.
# ALLOW_FILE and OUT_FILE are overridden by the tests and by `deno task e2e:local` only.
set -eu

ALLOW_FILE="${ALLOW_FILE:-/etc/spa/public-env.allow}"
OUT_FILE="${OUT_FILE:-/tmp/config.json}"

# A value reaches the file inside a JSON string. Backslash and double quote are escaped. A control
# character (tab, carriage return from an env file with Windows line endings, newline, DEL) has no
# safe place there, so the script stops: a container that fails to start is noticed, a config file
# that browsers reject silently turns error reporting off.
escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Fails, naming the variable and never its value, when the value holds a control character.
reject_control_characters() {
  COUNT="$(printf '%s' "$2" | LC_ALL=C tr -d '\040-\176\200-\377' | wc -c)"
  if [ "$COUNT" -ne 0 ]; then
    echo "spa: $1 holds a control character (tab, carriage return, newline); not writing $OUT_FILE" >&2
    rm -f "$TMP"
    exit 1
  fi
}

TMP="$OUT_FILE.tmp"
printf '{' > "$TMP"
SEP=''
while read -r NAME KEY || [ -n "$NAME" ]; do
  case "$NAME" in '' | '#'*) continue ;; esac
  VALUE="$(printenv "$NAME" || true)"
  # An unset or empty variable is left out, so the app falls back to its default.
  [ -n "$VALUE" ] || continue
  reject_control_characters "$NAME" "$VALUE"
  printf '%s"%s":"%s"' "$SEP" "$KEY" "$(escape "$VALUE")" >> "$TMP"
  SEP=','
done < "$ALLOW_FILE"
printf '}\n' >> "$TMP"
mv "$TMP" "$OUT_FILE"
echo "spa: wrote $OUT_FILE"
