#!/bin/sh
# Writes the part of the SPA's content security policy that differs per deployment, when the
# container starts: the nginx variable $csp_error_tracker, which nginx.conf includes and the policy's
# connect-src names. It holds the origin of SPA_ERROR_REPORT_DSN, where the app posts its error
# reports, or nothing when the variable is unset, and then the page may connect to its own origin
# only. nginx's entrypoint runs it before nginx starts. OUT_FILE is overridden by the tests only.
set -eu

OUT_FILE="${OUT_FILE:-/tmp/csp-connect.conf}"
DSN="${SPA_ERROR_REPORT_DSN:-}"

# The value is never printed: a container log is shipped.
refuse() {
  echo "spa: SPA_ERROR_REPORT_DSN $1; not writing $OUT_FILE" >&2
  exit 1
}

ORIGIN=''
if [ -n "$DSN" ]; then
  # The origin lands inside a quoted string of nginx configuration, so only a value made of these
  # characters gets that far: none of them can end the string, start a variable or add a line.
  case "$DSN" in
    *[!A-Za-z0-9.:/@_-]*) refuse "holds a character a tracker address never has" ;;
  esac
  # scheme://key@host:port/project, with the key and the port optional.
  ORIGIN="$(printf '%s' "$DSN" |
    sed -n -E 's#^(https?)://([^@/]*@)?([A-Za-z0-9.-]+)(:[0-9]+)?(/.*)?$#\1://\3\4#p')"
  [ -n "$ORIGIN" ] || refuse "is not an http or https address"
fi

TMP="$OUT_FILE.tmp"
printf 'set $csp_error_tracker "%s";\n' "$ORIGIN" > "$TMP"
mv "$TMP" "$OUT_FILE"
echo "spa: wrote $OUT_FILE"
