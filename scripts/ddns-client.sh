#!/usr/bin/env bash
set -euo pipefail

APP_NAME="cf-ddns-manager"
CRON_TAG="# ${APP_NAME}"
CONFIG_FILE="${HOME}/.config/${APP_NAME}/client.env"
APP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/${APP_NAME}"
INSTALL_SCRIPT="${APP_DIR}/ddns-client.sh"
LOG_FILE="${HOME}/.cache/${APP_NAME}/client.log"
CLIENT_SCRIPT_URL="${CLIENT_SCRIPT_URL:-https://raw.githubusercontent.com/Loongel/cloudflare-ddns-manager-worker/main/scripts/ddns-client.sh}"
IPV4_LOOKUP_URL="${IPV4_LOOKUP_URL:-https://api.ipify.org}"
IPV6_LOOKUP_URL="${IPV6_LOOKUP_URL:-https://api6.ipify.org}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-8}"
DDNS_USER_AGENT="${DDNS_USER_AGENT:-cf-ddns-manager-client/1.0}"

URL=""
TOKEN=""
DOMAIN=""
HOST=""
TYPE="auto"
IPV4=""
IPV6=""
TTL=""
PROXIED=""
MODE="run"
CONFIG_LOADED="false"
EFFECTIVE_IPV4=""
EFFECTIVE_IPV6=""
DEBUG="false"

usage() {
  cat <<'EOF'
Cloudflare Worker DDNS client

Usage:
  ddns-client.sh --install --manage-endpoint ddns.example.com --ddns-token TOKEN [options]
  ddns-client.sh --config ~/.config/cf-ddns-manager/client.env
  ddns-client.sh --uninstall

Required:
  --manage-endpoint HOST_OR_URL  Manager hostname or update endpoint.
                                 Example: ddns.example.com
  --ddns-token TOKEN             Admin or scoped DDNS token.

Options:
  --ddns-suffix DOMAIN  DDNS suffix. Defaults to the --manage-endpoint hostname.
  --sub-domain NAME     Sub-domain before the suffix. Defaults to `hostname -s`.
  --record-type TYPE    auto, A, AAAA, or both. Defaults to auto.
  --ipv4 IP             Explicit IPv4 address. If omitted, the client tries curl -4 detection.
  --ipv6 IP             Explicit IPv6 address. If omitted, the client tries curl -6 detection.
  --ttl SECONDS         Override DNS record TTL.
  --proxied BOOL        Override Cloudflare proxy setting: true or false.
  --user-agent VALUE    User-Agent sent to the Manager Worker.
                        Defaults to cf-ddns-manager-client/1.0.
  --config FILE         Load options from a config file.
  --install             Save config and install current user's crontab to run every 5 minutes.
  --uninstall           Delete this client's DNS record, crontab entry, config, and installed script.
  --debug               Print endpoint, IP detection, and HTTP diagnostics. Token is redacted.
  -h, --help            Show this help.

Backward-compatible aliases:
  --ddns-manager, --url, --endpoint     Same as --manage-endpoint.
  --ddns-secret, --token, --secret      Same as --ddns-token.
  --ddns-domain, --domain, --suffix     Same as --ddns-suffix.
  --device, --host, --name              Same as --sub-domain.
  --type                                Same as --record-type.

Examples:
  ddns-client.sh --install --manage-endpoint ddns.example.com \
    --ddns-token 'change-me' --sub-domain nas

  ddns-client.sh --manage-endpoint ddns.example.com \
    --ddns-token 'change-me' --ddns-suffix home.example.com --sub-domain nas --ipv4 203.0.113.10
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

debug_log() {
  [[ "$DEBUG" == "true" ]] || return 0
  printf 'debug: %s\n' "$*" >&2
}

need_value() {
  local key="${1:-}"
  local value="${2:-}"
  [[ -n "$value" && "$value" != --* ]] || die "${key} requires a value"
}

normalize_endpoint() {
  local endpoint="$1"
  local path rest
  endpoint="${endpoint#"${endpoint%%[![:space:]]*}"}"
  endpoint="${endpoint%"${endpoint##*[![:space:]]}"}"

  [[ -n "$endpoint" ]] || die "--manage-endpoint cannot be empty"
  [[ "$endpoint" != *[[:space:]]* ]] || die "--manage-endpoint must not contain spaces"

  if [[ "$endpoint" != http://* && "$endpoint" != https://* ]]; then
    endpoint="https://${endpoint}"
  fi
  if [[ "$endpoint" =~ ^https?://[^/]+/?$ ]]; then
    endpoint="${endpoint%/}/ddns/update"
  fi
  [[ "$endpoint" =~ ^https?://[^/]+/.+ ]] ||
    die "--manage-endpoint must be a Manager hostname or URL, for example ddns.example.com"
  rest="${endpoint#*://}"
  path="/${rest#*/}"
  path="${path%%\?*}"
  [[ "$path" == "/ddns/update" || "$path" == "/update" ]] ||
    die "--manage-endpoint path must be /ddns/update or /update. Prefer: --manage-endpoint ddns.example.com"

  printf '%s' "$endpoint"
}

endpoint_host() {
  local endpoint
  endpoint="$(normalize_endpoint "$1")"
  endpoint="${endpoint#https://}"
  endpoint="${endpoint#http://}"
  printf '%s' "${endpoint%%/*}"
}

validate_domain_labels() {
  local value="$1"
  local field="$2"
  local label
  local -a labels

  [[ -n "$value" ]] || die "${field} cannot be empty"
  [[ "$value" != .* && "$value" != *. ]] || die "${field} must not start or end with a dot"
  IFS='.' read -r -a labels <<< "$value"
  ((${#labels[@]} >= 1)) || die "${field} is invalid"
  for label in "${labels[@]}"; do
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] ||
      die "${field} has an invalid DNS label: ${label:-<empty>}"
  done
}

is_ipv4() {
  local value="$1"
  local part
  local -a parts
  [[ "$value" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  IFS='.' read -r -a parts <<< "$value"
  for part in "${parts[@]}"; do
    ((10#$part >= 0 && 10#$part <= 255)) || return 1
  done
}

is_ipv6() {
  [[ "$1" =~ ^[0-9A-Fa-f:]+$ && "$1" == *:* && "$1" != ":" ]]
}

detect_public_ip() {
  local family="$1"
  local url="$2"
  local candidate=""
  debug_log "detecting public ${family} via ${url}"
  candidate="$(curl "--${family}" --silent --show-error --max-time "$CURL_CONNECT_TIMEOUT" "$url" 2>/dev/null | tr -d '[:space:]' || true)"
  case "$family" in
    ipv4)
      if is_ipv4 "$candidate"; then
        debug_log "detected ipv4=${candidate}"
        printf '%s' "$candidate"
      else
        debug_log "no valid ipv4 detected"
      fi
      ;;
    ipv6)
      if is_ipv6 "$candidate"; then
        debug_log "detected ipv6=${candidate}"
        printf '%s' "$candidate"
      else
        debug_log "no valid ipv6 detected"
      fi
      ;;
  esac
  return 0
}

fill_effective_ips() {
  EFFECTIVE_IPV4="$IPV4"
  EFFECTIVE_IPV6="$IPV6"
  case "$TYPE" in
    AUTO|BOTH)
      [[ -n "$EFFECTIVE_IPV4" ]] || EFFECTIVE_IPV4="$(detect_public_ip ipv4 "$IPV4_LOOKUP_URL")"
      [[ -n "$EFFECTIVE_IPV6" ]] || EFFECTIVE_IPV6="$(detect_public_ip ipv6 "$IPV6_LOOKUP_URL")"
      ;;
    A)
      [[ -n "$EFFECTIVE_IPV4" ]] || EFFECTIVE_IPV4="$(detect_public_ip ipv4 "$IPV4_LOOKUP_URL")"
      ;;
    AAAA)
      [[ -n "$EFFECTIVE_IPV6" ]] || EFFECTIVE_IPV6="$(detect_public_ip ipv6 "$IPV6_LOOKUP_URL")"
      ;;
  esac
}

print_body_excerpt() {
  local file="$1"
  if [[ ! -s "$file" ]]; then
    return
  fi
  tr '\n\r\t' '   ' < "$file" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' | cut -c 1-220
}

body_looks_like_html() {
  local file="$1"
  grep -Eiq '<!doctype html|<html[[:space:]>]|<head[[:space:]>]|<body[[:space:]>]' "$file"
}

body_looks_like_json() {
  local file="$1"
  grep -Eq '^[[:space:]]*[\{\[]' "$file"
}

print_endpoint_error() {
  local http_code="$1"
  local content_type="$2"
  local body_file="$3"
  local curl_error="$4"

  if [[ -n "$curl_error" ]]; then
    die "无法连接 --manage-endpoint：${URL}。${curl_error}"
  fi

  if body_looks_like_html "$body_file"; then
    die "--manage-endpoint 返回 HTML，不是 DDNS API。请填写 Worker 管理域名。HTTP ${http_code}"
  fi

  if [[ "$content_type" != *json* ]] && ! body_looks_like_json "$body_file"; then
    local excerpt
    excerpt="$(print_body_excerpt "$body_file")"
    if [[ -n "$excerpt" ]]; then
      die "--manage-endpoint 返回非 JSON。HTTP ${http_code}，摘要：${excerpt}"
    fi
    die "--manage-endpoint 返回非 JSON。HTTP ${http_code}"
  fi

  printf 'DDNS 更新失败。HTTP %s：\n' "$http_code" >&2
  sed -n '1,20p' "$body_file" >&2
  die "请检查 endpoint、token、后缀和节点名称。"
}

should_retry_ipv4() {
  local http_code="$1"
  local body_file="$2"
  [[ "$http_code" == "403" ]] && body_looks_like_html "$body_file"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manage-endpoint|--ddns-manager|--endpoint|--ddns-endpoint|--manager|--url)
      need_value "$1" "${2:-}"
      URL="$2"
      shift 2
      ;;
    --ddns-token|--ddns-secret|--secret|--token)
      need_value "$1" "${2:-}"
      TOKEN="$2"
      shift 2
      ;;
    --ddns-suffix|--ddns-domain|--service-domain|--domain|--service|--suffix)
      need_value "$1" "${2:-}"
      DOMAIN="$2"
      shift 2
      ;;
    --sub-domain|--device|--device-name|--host|--name|--subdomain)
      need_value "$1" "${2:-}"
      HOST="$2"
      shift 2
      ;;
    --record-type|--type)
      need_value "$1" "${2:-}"
      TYPE="$2"
      shift 2
      ;;
    --ipv4)
      need_value "$1" "${2:-}"
      IPV4="$2"
      shift 2
      ;;
    --ipv6)
      need_value "$1" "${2:-}"
      IPV6="$2"
      shift 2
      ;;
    --ttl)
      need_value "$1" "${2:-}"
      TTL="$2"
      shift 2
      ;;
    --proxied)
      need_value "$1" "${2:-}"
      PROXIED="$2"
      shift 2
      ;;
    --user-agent)
      need_value "$1" "${2:-}"
      DDNS_USER_AGENT="$2"
      shift 2
      ;;
    --config)
      need_value "$1" "${2:-}"
      # shellcheck source=/dev/null
      source "$2"
      CONFIG_LOADED="true"
      shift 2
      ;;
    --install)
      MODE="install"
      shift
      ;;
    --uninstall)
      MODE="uninstall"
      shift
      ;;
    --debug)
      DEBUG="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

if [[ "$MODE" == "uninstall" && "$CONFIG_LOADED" != "true" && -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  CONFIG_LOADED="true"
fi

HOST="${HOST:-$(hostname -s 2>/dev/null || hostname)}"

validate_required() {
  [[ -n "$URL" ]] || die "--manage-endpoint is required. Example: --manage-endpoint ddns.example.com"
  [[ -n "$TOKEN" ]] || die "--ddns-token is required"
  URL="$(normalize_endpoint "$URL")"
  if [[ -z "$DOMAIN" ]]; then
    DOMAIN="$(endpoint_host "$URL")"
  fi
  [[ -n "$HOST" ]] || die "--sub-domain is empty and hostname could not be detected"
  command -v curl >/dev/null 2>&1 || die "curl is required"

  TYPE="${TYPE^^}"
  validate_domain_labels "$DOMAIN" "--ddns-suffix"
  [[ "$DOMAIN" == *.* ]] || die "--ddns-suffix should include at least one dot, for example home.example.com"
  [[ "$HOST" != *.* ]] || die "--sub-domain should be only the node name, for example nas, not nas.${DOMAIN}"
  validate_domain_labels "$HOST" "--sub-domain"
  [[ "$TYPE" =~ ^(AUTO|A|AAAA|BOTH)$ ]] || die "--record-type must be auto, A, AAAA, or both"
  [[ -z "$IPV4" ]] || is_ipv4 "$IPV4" || die "--ipv4 is not a valid IPv4 address"
  [[ -z "$IPV6" ]] || is_ipv6 "$IPV6" || die "--ipv6 is not a valid IPv6 address"
  if [[ -n "$TTL" ]]; then
    [[ "$TTL" =~ ^[0-9]+$ && "$TTL" -ge 1 ]] || die "--ttl must be a positive integer"
  fi
  [[ -z "$PROXIED" || "${PROXIED,,}" =~ ^(true|false|1|0|yes|no|on|off)$ ]] ||
    die "--proxied must be true or false"
  [[ -n "$DDNS_USER_AGENT" && "$DDNS_USER_AGENT" != *$'\n'* && "$DDNS_USER_AGENT" != *$'\r'* ]] ||
    die "--user-agent cannot be empty or contain newlines"
  debug_log "mode=${MODE}"
  debug_log "endpoint=${URL}"
  debug_log "domain=${DOMAIN}"
  debug_log "host=${HOST}"
  debug_log "record_type=${TYPE}"
  debug_log "user_agent=${DDNS_USER_AGENT}"
  debug_log "token=***REDACTED***"
}

shell_quote() {
  printf '%q' "$1"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

write_config() {
  mkdir -p "$(dirname "$CONFIG_FILE")"
  chmod 700 "$(dirname "$CONFIG_FILE")"
  {
    printf 'URL=%s\n' "$(shell_quote "$URL")"
    printf 'TOKEN=%s\n' "$(shell_quote "$TOKEN")"
    printf 'DOMAIN=%s\n' "$(shell_quote "$DOMAIN")"
    printf 'HOST=%s\n' "$(shell_quote "$HOST")"
    printf 'TYPE=%s\n' "$(shell_quote "$TYPE")"
    printf 'IPV4=%s\n' "$(shell_quote "$IPV4")"
    printf 'IPV6=%s\n' "$(shell_quote "$IPV6")"
    printf 'TTL=%s\n' "$(shell_quote "$TTL")"
    printf 'PROXIED=%s\n' "$(shell_quote "$PROXIED")"
    printf 'DDNS_USER_AGENT=%s\n' "$(shell_quote "$DDNS_USER_AGENT")"
  } > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

install_script_file() {
  mkdir -p "$APP_DIR"
  chmod 700 "$APP_DIR"

  local current_script="${BASH_SOURCE[0]}"
  if [[ -f "$current_script" && -r "$current_script" ]]; then
    local current_abs install_abs
    current_abs="$(cd "$(dirname "$current_script")" && pwd)/$(basename "$current_script")"
    install_abs="$(cd "$APP_DIR" && pwd)/$(basename "$INSTALL_SCRIPT")"
    if [[ "$current_abs" != "$install_abs" ]]; then
      cp "$current_abs" "$INSTALL_SCRIPT"
    fi
  else
    curl -fsSL "$CLIENT_SCRIPT_URL" > "$INSTALL_SCRIPT"
  fi
  chmod 700 "$INSTALL_SCRIPT"
}

install_cron() {
  mkdir -p "$(dirname "$LOG_FILE")"

  local schedule="*/5 * * * *"
  local entry="*/5 * * * * $(shell_quote "$INSTALL_SCRIPT") --config $(shell_quote "$CONFIG_FILE") >> $(shell_quote "$LOG_FILE") 2>&1 ${CRON_TAG}"
  local current
  current="$(mktemp)"
  crontab -l 2>/dev/null | grep -vF "$CRON_TAG" > "$current" || true
  printf '%s\n' "$entry" >> "$current"
  crontab "$current"
  rm -f "$current"
  printf 'Installed cf-ddns-manager client.\n'
  printf '  Script:   %s\n' "$INSTALL_SCRIPT"
  printf '  Config:   %s\n' "$CONFIG_FILE"
  printf '  Log:      %s\n' "$LOG_FILE"
  printf '  Schedule: %s\n' "$schedule"
  printf '  Cron tag: %s\n' "$CRON_TAG"
}

uninstall_cron() {
  local current
  current="$(mktemp)"
  crontab -l 2>/dev/null | grep -vF "$CRON_TAG" > "$current" || true
  crontab "$current"
  rm -f "$current"
  printf 'Removed crontab entries tagged %s\n' "$CRON_TAG"
}

api_root_from_endpoint() {
  local endpoint="$1"
  endpoint="$(normalize_endpoint "$endpoint")"
  if [[ "$endpoint" =~ ^(https?://[^/]+) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi
  die "could not derive Manager API root from --manage-endpoint"
}

delete_remote_records() {
  validate_required

  local api_root body records_json type record_types body_file meta_file error_file curl_status http_code content_type
  api_root="$(api_root_from_endpoint "$URL")"

  case "$TYPE" in
    A) record_types=("A") ;;
    AAAA) record_types=("AAAA") ;;
    AUTO|BOTH) record_types=("A" "AAAA") ;;
    *) die "--record-type must be auto, A, AAAA, or both" ;;
  esac

  records_json=""
  for type in "${record_types[@]}"; do
    records_json+="${records_json:+,}{\"domain\":\"$(json_escape "$DOMAIN")\",\"host\":\"$(json_escape "$HOST")\",\"type\":\"${type}\"}"
  done
  body="{\"records\":[${records_json}],\"ignoreMissing\":true,\"ignoreUnowned\":true}"

  body_file="$(mktemp)"
  meta_file="$(mktemp)"
  error_file="$(mktemp)"

  if curl --silent --show-error \
    --request DELETE \
    --output "$body_file" \
    --write-out "%{http_code}\n%{content_type}" \
    --header "Authorization: Bearer ${TOKEN}" \
    --header "User-Agent: ${DDNS_USER_AGENT}" \
    --header "content-type: application/json" \
    --data "$body" \
    "${api_root}/api/records" > "$meta_file" 2> "$error_file"; then
    curl_status=0
  else
    curl_status=$?
  fi

  http_code="$(sed -n '1p' "$meta_file")"
  content_type="$(sed -n '2p' "$meta_file")"
  if [[ "$curl_status" -ne 0 || ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    if [[ "${http_code:-000}" == "403" ]] && grep -Eq '"record_not_owned"|record_not_owned|not owned by this DDNS token' "$body_file"; then
      printf 'Remote DNS cleanup skipped: record is not owned by this DDNS token.\n'
      rm -f "$body_file" "$meta_file" "$error_file"
      return 0
    fi
    print_endpoint_error "${http_code:-000}" "$content_type" "$body_file" "$(tr '\n' ' ' < "$error_file" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  fi
  if [[ "$content_type" != *json* ]] && ! body_looks_like_json "$body_file"; then
    print_endpoint_error "$http_code" "$content_type" "$body_file" ""
  fi

  cat "$body_file"
  printf '\n'
  rm -f "$body_file" "$meta_file" "$error_file"
}

remove_local_files() {
  rm -f "$CONFIG_FILE"
  rm -f "$INSTALL_SCRIPT"
  rmdir "$(dirname "$CONFIG_FILE")" "$APP_DIR" 2>/dev/null || true
}

run_update() {
  validate_required
  fill_effective_ips
  debug_log "effective_ipv4=${EFFECTIVE_IPV4:-<none>}"
  debug_log "effective_ipv6=${EFFECTIVE_IPV6:-<none>}"

  local body_file meta_file error_file curl_status http_code content_type retry_ipv4
  body_file="$(mktemp)"
  meta_file="$(mktemp)"
  error_file="$(mktemp)"
  trap "rm -f '$body_file' '$meta_file' '$error_file'" EXIT

  local args=(
    --silent
    --show-error
    --get
    --output "$body_file"
    --write-out "%{http_code}\n%{content_type}"
    --user-agent "${DDNS_USER_AGENT}"
    --header "Authorization: Bearer ${TOKEN}"
    --data-urlencode "domain=${DOMAIN}"
    --data-urlencode "host=${HOST}"
    --data-urlencode "type=${TYPE}"
  )

  [[ -z "$EFFECTIVE_IPV4" ]] || args+=(--data-urlencode "ipv4=${EFFECTIVE_IPV4}")
  [[ -z "$EFFECTIVE_IPV6" ]] || args+=(--data-urlencode "ipv6=${EFFECTIVE_IPV6}")
  [[ -z "$TTL" ]] || args+=(--data-urlencode "ttl=${TTL}")
  [[ -z "$PROXIED" ]] || args+=(--data-urlencode "proxied=${PROXIED}")

  debug_log "request_url=${URL}"
  debug_log "request_force_ipv4=false"
  if curl "${args[@]}" "$URL" > "$meta_file" 2> "$error_file"; then
    curl_status=0
  else
    curl_status=$?
  fi

  http_code="$(sed -n '1p' "$meta_file")"
  content_type="$(sed -n '2p' "$meta_file")"
  debug_log "http_status=${http_code:-000}"
  debug_log "content_type=${content_type:-<none>}"
  debug_log "body_excerpt=$(print_body_excerpt "$body_file")"
  retry_ipv4="false"
  if should_retry_ipv4 "${http_code:-000}" "$body_file"; then
    retry_ipv4="true"
  fi
  if [[ "$retry_ipv4" == "true" ]]; then
    : > "$body_file"
    : > "$meta_file"
    : > "$error_file"
    debug_log "retrying update over IPv4 because the first response was HTML HTTP 403"
    debug_log "request_force_ipv4=true"
    if curl --ipv4 "${args[@]}" "$URL" > "$meta_file" 2> "$error_file"; then
      curl_status=0
    else
      curl_status=$?
    fi
    http_code="$(sed -n '1p' "$meta_file")"
    content_type="$(sed -n '2p' "$meta_file")"
    debug_log "retry_http_status=${http_code:-000}"
    debug_log "retry_content_type=${content_type:-<none>}"
    debug_log "retry_body_excerpt=$(print_body_excerpt "$body_file")"
  fi
  if [[ "$curl_status" -ne 0 ]]; then
    print_endpoint_error "${http_code:-000}" "$content_type" "$body_file" "$(tr '\n' ' ' < "$error_file" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
  fi
  if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    print_endpoint_error "${http_code:-000}" "$content_type" "$body_file" ""
  fi
  if [[ "$content_type" != *json* ]] && ! body_looks_like_json "$body_file"; then
    print_endpoint_error "$http_code" "$content_type" "$body_file" ""
  fi

  cat "$body_file"
  printf '\n'
}

case "$MODE" in
  install)
    run_update
    write_config
    install_script_file
    install_cron
    ;;
  uninstall)
    if [[ "$CONFIG_LOADED" == "true" || -n "$URL$TOKEN$DOMAIN" ]]; then
      if ! ( delete_remote_records ); then
        printf 'warning: failed to delete remote DNS record; continuing local uninstall.\n' >&2
      fi
    else
      printf 'warning: no client config found at %s; skipping remote DNS deletion.\n' "$CONFIG_FILE" >&2
    fi
    uninstall_cron
    remove_local_files
    ;;
  run)
    run_update
    ;;
esac
