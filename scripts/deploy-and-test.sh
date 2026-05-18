#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_SCRIPT="${ROOT_DIR}/src/worker.js"
COMPATIBILITY_DATE="${COMPATIBILITY_DATE:-2026-05-16}"
DEFAULT_TTL="${DEFAULT_TTL:-120}"
DEFAULT_PROXIED="${DEFAULT_PROXIED:-false}"

WORKER_NAME="${WORKER_NAME:-}"
DDNS_DOMAIN="${DDNS_DOMAIN:-}"
DDNS_DOMAIN_CONFIGS="${DDNS_DOMAIN_CONFIGS:-}"
MANAGE_ENDPOINT="${MANAGE_ENDPOINT:-}"
CF_ZONE_ID="${CF_ZONE_ID:-}"
TEST_HOST="${TEST_HOST:-}"
CF_API_TOKEN="${CF_API_TOKEN:-}"
DDNS_ADMIN_TOKEN="${DDNS_ADMIN_TOKEN:-}"
DDNS_TOKEN="${DDNS_TOKEN:-}"
DDNS_SECRET="${DDNS_SECRET:-}"
DDNS_TOKENS_KV_ID="${DDNS_TOKENS_KV_ID:-}"
WORKER_URL="${WORKER_URL:-}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-}"
RESULT_FILE="${RESULT_FILE:-}"
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
LOADED_ENV_FILE=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '\n==> %s\n' "$*"
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || return
  LOADED_ENV_FILE="$file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue

    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi

    case "$key" in
      WORKER_NAME|DDNS_DOMAIN|DDNS_DOMAIN_CONFIGS|MANAGE_ENDPOINT|CF_ZONE_ID|TEST_HOST|CF_API_TOKEN|DDNS_ADMIN_TOKEN|DDNS_TOKEN|DDNS_SECRET|DDNS_TOKENS_KV_ID|WORKER_URL|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|COMPATIBILITY_DATE|DEFAULT_TTL|DEFAULT_PROXIED)
        printf -v "$key" '%s' "$value"
        export "$key"
        ;;
    esac
  done < "$file"
}

load_default_env_file() {
  if [[ -n "$DEPLOY_ENV_FILE" ]]; then
    load_env_file "$DEPLOY_ENV_FILE"
    return
  fi

  local candidate
  for candidate in "${ROOT_DIR}/cf-ddns-deploy.env" "${ROOT_DIR}/cf-ddns-deply.env"; do
    if [[ -f "$candidate" ]]; then
      load_env_file "$candidate"
      return
    fi
  done
}

prompt_required() {
  local var_name="$1"
  local prompt="$2"
  local current="${!var_name:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    die "$var_name is required in non-interactive mode"
  fi
  read -r -p "${prompt}: " current
  [[ -n "$current" ]] || die "$var_name cannot be empty"
  printf -v "$var_name" '%s' "$current"
}

prompt_secret() {
  local var_name="$1"
  local prompt="$2"
  local current="${!var_name:-}"
  if [[ -n "$current" ]]; then
    return
  fi
  if [[ ! -t 0 ]]; then
    die "$var_name is required in non-interactive mode"
  fi
  read -r -s -p "${prompt}: " current
  printf '\n'
  [[ -n "$current" ]] || die "$var_name cannot be empty"
  printf -v "$var_name" '%s' "$current"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

shell_quote() {
  printf '%q' "$1"
}

normalize_bool() {
  case "${1,,}" in
    true|1|yes|on) printf 'true' ;;
    false|0|no|off) printf 'false' ;;
    *) return 1 ;;
  esac
}

host_only() {
  local value="$1"
  value="${value#https://}"
  value="${value#http://}"
  printf '%s' "${value%%/*}"
}

reject_url_path() {
  local value="$1"
  local field="$2"
  local without_scheme
  [[ "$value" != *[[:space:]]* ]] || die "$field must not contain spaces"
  without_scheme="${value#https://}"
  without_scheme="${without_scheme#http://}"
  [[ "$without_scheme" != */* ]] ||
    die "$field must be a hostname only. Example: ddns.example.com"
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

curl_json_or_die() {
  local description="$1"
  shift
  local body_file meta_file error_file curl_status http_code content_type curl_error excerpt
  body_file="$(mktemp)"
  meta_file="$(mktemp)"
  error_file="$(mktemp)"

  if curl --silent --show-error --output "$body_file" --write-out "%{http_code}\n%{content_type}" "$@" > "$meta_file" 2> "$error_file"; then
    curl_status=0
  else
    curl_status=$?
  fi

  http_code="$(sed -n '1p' "$meta_file")"
  content_type="$(sed -n '2p' "$meta_file")"
  if [[ "$curl_status" -ne 0 ]]; then
    curl_error="$(tr '\n' ' ' < "$error_file" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
    rm -f "$body_file" "$meta_file" "$error_file"
    die "$description failed to connect: ${curl_error}"
  fi
  if body_looks_like_html "$body_file"; then
    rm -f "$body_file" "$meta_file" "$error_file"
    die "$description returned HTML, not DDNS API. HTTP ${http_code}."
  fi
  if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    printf '%s failed. HTTP %s. Response:\n' "$description" "${http_code:-000}" >&2
    sed -n '1,20p' "$body_file" >&2
    rm -f "$body_file" "$meta_file" "$error_file"
    exit 1
  fi
  if [[ "$content_type" != *json* ]] && ! body_looks_like_json "$body_file"; then
    excerpt="$(print_body_excerpt "$body_file")"
    rm -f "$body_file" "$meta_file" "$error_file"
    die "$description returned non-JSON. HTTP ${http_code}${excerpt:+: ${excerpt}}"
  fi

  cat "$body_file"
  rm -f "$body_file" "$meta_file" "$error_file"
}

validate_inputs() {
  [[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] ||
    die "WORKER_NAME must use lowercase letters, numbers, and hyphens"
  if [[ -n "$MANAGE_ENDPOINT" ]]; then
    reject_url_path "$MANAGE_ENDPOINT" "MANAGE_ENDPOINT"
    MANAGE_ENDPOINT="$(host_only "$MANAGE_ENDPOINT")"
  fi
  if [[ -z "$DDNS_DOMAIN" && -n "$MANAGE_ENDPOINT" ]]; then
    DDNS_DOMAIN="$MANAGE_ENDPOINT"
  fi
  reject_url_path "$DDNS_DOMAIN" "DDNS_DOMAIN"
  DDNS_DOMAIN="$(host_only "$DDNS_DOMAIN")"
  [[ "$DDNS_DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$DDNS_DOMAIN" == *.* ]] ||
    die "DDNS_DOMAIN must look like a DNS suffix, for example home.example.com"
  [[ -n "$DDNS_DOMAIN_CONFIGS" || -n "$CF_ZONE_ID" ]] ||
    die "CF_ZONE_ID is required unless DDNS_DOMAIN_CONFIGS is set"
  if [[ -n "$TEST_HOST" ]]; then
    [[ "$TEST_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] ||
      die "TEST_HOST must be a single DNS label"
  fi
  [[ "$DEFAULT_TTL" =~ ^[0-9]+$ && "$DEFAULT_TTL" -ge 1 ]] ||
    die "DEFAULT_TTL must be a positive integer"
  DEFAULT_PROXIED="$(normalize_bool "$DEFAULT_PROXIED")" ||
    die "DEFAULT_PROXIED must be true or false"
}

generate_ddns_secret() {
  if [[ -z "$DDNS_ADMIN_TOKEN" ]]; then
    DDNS_ADMIN_TOKEN="${DDNS_SECRET:-$(openssl rand -base64 32)}"
    GENERATED_DDNS_ADMIN_TOKEN="true"
  else
    GENERATED_DDNS_ADMIN_TOKEN="false"
  fi
  if [[ -z "$DDNS_TOKEN" ]]; then
    DDNS_TOKEN="$(openssl rand -base64 32)"
    GENERATED_DDNS_TOKEN="true"
  else
    GENERATED_DDNS_TOKEN="false"
  fi
  DDNS_SECRET="$DDNS_ADMIN_TOKEN"
}

persist_generated_ddns_secret() {
  [[ -n "$LOADED_ENV_FILE" ]] || return 0

  chmod 600 "$LOADED_ENV_FILE"
  if [[ "${GENERATED_DDNS_ADMIN_TOKEN:-false}" == "true" ]]; then
    printf '\nDDNS_ADMIN_TOKEN=%s\n' "$(shell_quote "$DDNS_ADMIN_TOKEN")" >> "$LOADED_ENV_FILE"
  fi
  if [[ "${GENERATED_DDNS_TOKEN:-false}" == "true" ]]; then
    printf '\nDDNS_TOKEN=%s\n' "$(shell_quote "$DDNS_TOKEN")" >> "$LOADED_ENV_FILE"
  fi
}

ensure_wrangler_login() {
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    return
  fi
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    die "CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_API_TOKEN is set"
  fi
  if npx wrangler whoami >/dev/null 2>&1; then
    return
  fi
  info "Wrangler is not logged in; opening Cloudflare login"
  npx wrangler login
  npx wrangler whoami >/dev/null
}

parse_worker_url() {
  local deploy_log="$1"
  local parsed_url
  parsed_url="$(grep -Eo 'https://[^[:space:]]+\.workers\.dev[^[:space:]]*' "$deploy_log" | head -n 1 || true)"
  if [[ -n "$parsed_url" ]]; then
    WORKER_URL="${parsed_url%/}"
  fi
  if [[ -z "$WORKER_URL" && -t 0 ]]; then
    read -r -p "Worker URL was not found in deploy output. Enter it manually: " WORKER_URL
    WORKER_URL="${WORKER_URL%/}"
  fi
  [[ -n "$WORKER_URL" ]] || die "Could not determine Worker URL. Set WORKER_URL and rerun."
}

run_health_check() {
  info "Checking Worker health"
  curl_json_or_die "Worker health check" "${WORKER_URL}/health"
  printf '\n'
}

run_ddns_check() {
  info "Updating ${TEST_HOST}.${DDNS_DOMAIN}"
  curl_json_or_die "DDNS update check" --get \
    --header "Authorization: Bearer ${DDNS_SECRET}" \
    --data-urlencode "domain=${DDNS_DOMAIN}" \
    --data-urlencode "host=${TEST_HOST}" \
    "${WORKER_URL}/ddns/update"
  printf '\n'
}

write_wrangler_config() {
  local file="$1"
  local domain_configs="$2"
  local escaped_worker escaped_script escaped_account escaped_configs escaped_ttl escaped_proxied escaped_kv_id
  escaped_worker="$(json_escape "$WORKER_NAME")"
  escaped_script="$(json_escape "$WORKER_SCRIPT")"
  escaped_account="$(json_escape "${CLOUDFLARE_ACCOUNT_ID:-}")"
  escaped_configs="$(json_escape "$domain_configs")"
  escaped_ttl="$(json_escape "$DEFAULT_TTL")"
  escaped_proxied="$(json_escape "$DEFAULT_PROXIED")"
  escaped_kv_id="$(json_escape "$DDNS_TOKENS_KV_ID")"

  {
    printf '{\n'
    printf '  "name": "%s",\n' "$escaped_worker"
    printf '  "main": "%s",\n' "$escaped_script"
    printf '  "compatibility_date": "%s",\n' "$COMPATIBILITY_DATE"
    if [[ -n "$escaped_account" ]]; then
      printf '  "account_id": "%s",\n' "$escaped_account"
    fi
    printf '  "vars": {\n'
    printf '    "DDNS_DOMAIN_CONFIGS": "%s",\n' "$escaped_configs"
    printf '    "DEFAULT_TTL": "%s",\n' "$escaped_ttl"
    printf '    "DEFAULT_PROXIED": "%s"\n' "$escaped_proxied"
    printf '  }\n'
    if [[ -n "$escaped_kv_id" ]]; then
      printf ',\n  "kv_namespaces": [\n'
      printf '    { "binding": "DDNS_TOKENS", "id": "%s" }\n' "$escaped_kv_id"
      printf '  ]\n'
    fi
    printf '}\n'
  } > "$file"
}

ensure_kv_namespace() {
  if [[ -n "$DDNS_TOKENS_KV_ID" ]]; then
    return
  fi
  [[ -n "$CLOUDFLARE_API_TOKEN" && -n "$CLOUDFLARE_ACCOUNT_ID" ]] ||
    die "DDNS_TOKENS_KV_ID is required unless CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID can create KV"

  local title response_file id
  title="${WORKER_NAME}-ddns-tokens"
  response_file="$(mktemp)"
  curl --fail-with-body --silent --show-error \
    --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces?per_page=100" > "$response_file"
  id="$(node -e "const fs=require('fs'); const title=process.argv[1]; const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const ns=(data.result||[]).find((item)=>item.title===title); process.stdout.write(ns?.id||'')" "$title" "$response_file")"
  if [[ -z "$id" ]]; then
    curl --fail-with-body --silent --show-error \
      --request POST \
      --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      --header "content-type: application/json" \
      --data "{\"title\":\"$(json_escape "$title")\"}" \
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces" > "$response_file"
    id="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(data.result?.id||'')" "$response_file")"
  fi
  rm -f "$response_file"
  [[ -n "$id" ]] || die "Could not create or find DDNS_TOKENS KV namespace"
  DDNS_TOKENS_KV_ID="$id"
  if [[ -n "$LOADED_ENV_FILE" ]]; then
    chmod 600 "$LOADED_ENV_FILE"
    printf '\nDDNS_TOKENS_KV_ID=%s\n' "$(shell_quote "$DDNS_TOKENS_KV_ID")" >> "$LOADED_ENV_FILE"
  fi
}

write_result_file() {
  if [[ -z "$RESULT_FILE" ]]; then
    return 0
  fi

  umask 077
  {
    printf 'WORKER_URL=%s\n' "$(shell_quote "$WORKER_URL")"
    printf 'DDNS_ADMIN_TOKEN=%s\n' "$(shell_quote "$DDNS_ADMIN_TOKEN")"
    printf 'DDNS_TOKEN=%s\n' "$(shell_quote "$DDNS_TOKEN")"
    printf 'DDNS_DOMAIN=%s\n' "$(shell_quote "$DDNS_DOMAIN")"
    printf 'TEST_HOST=%s\n' "$(shell_quote "$TEST_HOST")"
  } > "$RESULT_FILE"
}

main() {
  cd "$ROOT_DIR"

  load_default_env_file

  need_command npm
  need_command npx
  need_command curl
  need_command openssl
  need_command grep
  need_command date
  need_command mktemp
  need_command tee
  need_command node

  prompt_required WORKER_NAME "Worker name, for example cf-ddns"
  if [[ -z "$MANAGE_ENDPOINT" ]]; then
    MANAGE_ENDPOINT="$DDNS_DOMAIN"
  fi
  prompt_required DDNS_DOMAIN "DDNS suffix, for example home.example.com"
  if [[ -z "$DDNS_DOMAIN_CONFIGS" ]]; then
    prompt_required CF_ZONE_ID "Cloudflare Zone ID for ${DDNS_DOMAIN}"
  fi
  prompt_secret CF_API_TOKEN "Cloudflare API token with DNS Edit permission"
  generate_ddns_secret
  persist_generated_ddns_secret
  validate_inputs
  ensure_kv_namespace

  local escaped_domain escaped_zone escaped_cf_token escaped_admin_token escaped_ddns_token domain_configs secrets_file deploy_log wrangler_config
  escaped_domain="$(json_escape "$DDNS_DOMAIN")"
  escaped_zone="$(json_escape "$CF_ZONE_ID")"
  escaped_cf_token="$(json_escape "$CF_API_TOKEN")"
  escaped_admin_token="$(json_escape "$DDNS_ADMIN_TOKEN")"
  escaped_ddns_token="$(json_escape "$DDNS_TOKEN")"
  if [[ -n "$DDNS_DOMAIN_CONFIGS" ]]; then
    domain_configs="$DDNS_DOMAIN_CONFIGS"
  else
    domain_configs="[{\"domain\":\"${escaped_domain}\",\"zoneId\":\"${escaped_zone}\",\"ttl\":${DEFAULT_TTL},\"proxied\":${DEFAULT_PROXIED}}]"
  fi
  secrets_file="$(mktemp)"
  deploy_log="$(mktemp)"
  wrangler_config="$(mktemp --suffix=.json)"
  trap "rm -f '$secrets_file' '$deploy_log' '$wrangler_config'" EXIT
  chmod 600 "$secrets_file"
  printf '{"CF_API_TOKEN":"%s","DDNS_ADMIN_TOKEN":"%s","DDNS_TOKEN":"%s","DDNS_SECRET":"%s"}\n' "$escaped_cf_token" "$escaped_admin_token" "$escaped_ddns_token" "$escaped_admin_token" > "$secrets_file"
  write_wrangler_config "$wrangler_config" "$domain_configs"

  info "Running local tests"
  npm test

  ensure_wrangler_login

  info "Deploying Worker ${WORKER_NAME}"
  local deploy_args=(wrangler --config "$wrangler_config" deploy --secrets-file "$secrets_file")
  if [[ -n "$MANAGE_ENDPOINT" && "$MANAGE_ENDPOINT" != *.workers.dev ]]; then
    deploy_args+=(--domain "$MANAGE_ENDPOINT")
  fi
  npx "${deploy_args[@]}" | tee "$deploy_log"

  if [[ -n "$MANAGE_ENDPOINT" ]]; then
    WORKER_URL="https://${MANAGE_ENDPOINT}"
  else
    parse_worker_url "$deploy_log"
  fi
  run_health_check
  if [[ -n "$TEST_HOST" ]]; then
    run_ddns_check
  else
    info "Skipping DNS write test because TEST_HOST is not set"
  fi

  write_result_file

  info "Client install command"
  local manager_host
  manager_host="${MANAGE_ENDPOINT:-$WORKER_URL}"
  manager_host="${manager_host#https://}"
  manager_host="${manager_host#http://}"
  manager_host="${manager_host%%/*}"
  local suffix_args=()
  if [[ "$DDNS_DOMAIN" != "$manager_host" ]]; then
    suffix_args=(--ddns-suffix "$(shell_quote "$DDNS_DOMAIN")")
  fi
  printf 'Admin token: full manager access, can create scoped tokens in the web UI.\n'
  printf 'Scoped token: can manage only records it creates.\n'
  printf 'Admin install command:\n'
  printf './scripts/ddns-client.sh --install \\\n'
  printf '  --manage-endpoint %s \\\n' "$(shell_quote "$manager_host")"
  printf '  --ddns-token %s \\\n' "$(shell_quote "$DDNS_ADMIN_TOKEN")"
  if [[ ${#suffix_args[@]} -gt 0 ]]; then
    printf '  %s %s \\\n' "${suffix_args[0]}" "${suffix_args[1]}"
  fi
  printf '  --sub-domain YOUR_NODE_NAME\n'
  printf 'Scoped install command:\n'
  printf './scripts/ddns-client.sh --install \\\n'
  printf '  --manage-endpoint %s \\\n' "$(shell_quote "$manager_host")"
  printf '  --ddns-token %s \\\n' "$(shell_quote "$DDNS_TOKEN")"
  if [[ ${#suffix_args[@]} -gt 0 ]]; then
    printf '  %s %s \\\n' "${suffix_args[0]}" "${suffix_args[1]}"
  fi
  printf '  --sub-domain YOUR_NODE_NAME\n'

  if [[ -n "$RESULT_FILE" ]]; then
    printf 'Saved deployment result and client secret to %s\n' "${RESULT_FILE#"$ROOT_DIR"/}"
  fi
}

main "$@"
