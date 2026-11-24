#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ACTION="up"
LICENSE_KEY="${LUTIC_LICENSE_KEY:-}"
LICENSE_SERVER="${LICENSE_SERVER_URL:-}"
ENV_FILE="${ROOT_DIR}/.env.production"
DRY_RUN="false"

usage() {
  cat <<'HELP'
Lutic Linux deployment CLI

Usage: bash deploy/lutic.sh [command] [options]

  prepare    Create a private production env file with generated secrets
  activate   Check a license with its issuer
  bootstrap  Initialize the first tenant, plant, and administrator account
  up         Start the configured stack and verify /api/health (default)
  status     Show containers and check /api/health
  logs       Tail the application logs
  down       Stop the stack

  --license-key <KEY>      Override LUTIC_LICENSE_KEY for this invocation
  --license-server <URL>   Override LICENSE_SERVER_URL for this invocation
  --env-file <PATH>        Use this file (default: ./.env.production)
  --dry-run                Print the planned operation
  -h, --help               Show this help message
HELP
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    prepare|activate|bootstrap|up|status|logs|down) ACTION="$1"; shift ;;
    --license-key|--license-server|--env-file)
      [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "Missing value for $1"
      case "$1" in
        --license-key) LICENSE_KEY="$2" ;;
        --license-server) LICENSE_SERVER="$2" ;;
        --env-file) ENV_FILE="$2" ;;
      esac
      shift 2
      ;;
    --dry-run) DRY_RUN="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

read_env_var() {
  [[ -f "$ENV_FILE" ]] || return 0
  local value
  value="$(awk -v k="$1" 'BEGIN{FS="="} $1==k {sub(/^[^=]*=/, ""); sub(/\r$/, ""); value=$0} END{print value}' "$ENV_FILE")"
  case "$value" in
    \"*\"|\'*\') value="${value:1:${#value}-2}" ;;
  esac
  printf '%s' "$value"
}

compose_cmd() {
  docker compose --project-directory "$ROOT_DIR" --env-file "$ENV_FILE" "$@"
}

prepare_env() {
  if [[ -f "$ENV_FILE" ]]; then
    printf 'Preserved existing deployment configuration at %s\n' "$ENV_FILE"
    return
  fi
  [[ ! -e "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "Deployment configuration must be a regular file"
  command -v openssl >/dev/null || fail "OpenSSL is required to generate deployment secrets"
  (
    umask 077
    local tmp pg_password auth_secret credential_key instance_id gateway_key
    tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    pg_password="$(openssl rand -hex 32)"
    auth_secret="$(openssl rand -hex 32)"
    credential_key="$(openssl rand -hex 32)"
    instance_id="$(openssl rand -hex 16)"
    gateway_key="sk-lutic-$(openssl rand -hex 32)"
    while IFS= read -r line; do
      case "$line" in
        POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$pg_password" ;;
        DATABASE_URL=*) printf 'DATABASE_URL=postgresql://lutic:%s@postgres:5432/lutic\n' "$pg_password" ;;
        AUTH_SECRET=*) printf 'AUTH_SECRET=%s\n' "$auth_secret" ;;
        CREDENTIAL_ENCRYPTION_KEY=*) printf 'CREDENTIAL_ENCRYPTION_KEY=%s\n' "$credential_key" ;;
        LUTIC_INSTANCE_ID=*) printf 'LUTIC_INSTANCE_ID=lutic-%s\n' "$instance_id" ;;
        LITELLM_MASTER_KEY=*) printf 'LITELLM_MASTER_KEY=%s\n' "$gateway_key" ;;
        LUTIC_AI_GATEWAY_KEY=*) printf 'LUTIC_AI_GATEWAY_KEY=%s\n' "$gateway_key" ;;
        *) printf '%s\n' "$line" ;;
      esac
    done < "${SCRIPT_DIR}/lutic.env.example" > "$tmp"
    if ln -n "$tmp" "$ENV_FILE" 2>/dev/null; then
      printf 'Created deployment configuration at %s\n' "$ENV_FILE"
    elif [[ -f "$ENV_FILE" ]]; then
      printf 'Preserved existing deployment configuration at %s\n' "$ENV_FILE"
    else
      fail "Cannot create deployment configuration at $ENV_FILE"
    fi
  )
}

LICENSE_KEY="${LICENSE_KEY:-$(read_env_var LUTIC_LICENSE_KEY)}"
LICENSE_SERVER="${LICENSE_SERVER:-$(read_env_var LICENSE_SERVER_URL)}"
LICENSE_ENFORCE="${LICENSE_ENFORCE:-$(read_env_var LICENSE_ENFORCE)}"
LICENSE_ENFORCE="${LICENSE_ENFORCE:-true}"
LICENSE_SERVER_PORT="${LICENSE_SERVER_PORT:-$(read_env_var LICENSE_SERVER_PORT)}"
LICENSE_SERVER_PORT="${LICENSE_SERVER_PORT:-4100}"
LUTIC_PORT="${LUTIC_PORT:-$(read_env_var LUTIC_PORT)}"
LUTIC_PORT="${LUTIC_PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${LUTIC_PORT}/api/health"

host_license_url() {
  case "${LICENSE_SERVER%/}" in
    ""|http://lutic-license-server:4100|http://lutic-license-server) printf 'http://127.0.0.1:%s' "$LICENSE_SERVER_PORT" ;;
    *) printf '%s' "${LICENSE_SERVER%/}" ;;
  esac
}

json_escape() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

verify_license_online() {
  local server instance_id raw http_code response
  server="$(host_license_url)"
  if [[ "$server" == *[@\?\#]* || "$server" =~ [[:space:]] ]]; then fail "Invalid license issuer URL"; fi
  case "$server" in
    https://*) ;;
    http://127.0.0.1:*|http://localhost:*)
      [[ "$ACTION" == activate ]] || fail "LICENSE_SERVER_URL requires an HTTPS production license issuer URL" ;;
    *) fail "LICENSE_SERVER_URL requires an HTTPS license issuer URL" ;;
  esac
  instance_id="${LUTIC_INSTANCE_ID:-$(read_env_var LUTIC_INSTANCE_ID)}"
  if [[ -z "$instance_id" ]]; then instance_id="$(hostname)"; fi
  if [[ "$LICENSE_KEY$instance_id" =~ [[:cntrl:]] ]]; then fail "Invalid license key or instance identifier"; fi

  printf 'Checking license issuer at %s/api/licenses/activate\n' "$server"
  if ! raw="$(printf '{"key":"%s","instanceId":"%s"}' "$(json_escape "$LICENSE_KEY")" "$(json_escape "$instance_id")" |
      curl --disable -sS --max-time 10 -w '\n%{http_code}' -H 'Content-Type: application/json' --data @- "${server}/api/licenses/activate")"; then
    fail "Unable to reach the license issuer"
  fi
  http_code="${raw##*$'\n'}"
  response="${raw%$'\n'*}"
  [[ "$http_code" =~ ^2[0-9][0-9]$ && "$response" =~ \"valid\"[[:space:]]*:[[:space:]]*true ]] || fail "License activation was rejected (HTTP $http_code)"
  printf 'License activated successfully.\n'
}

if [[ "$ACTION" == activate || ( "$ACTION" == up && "$LICENSE_ENFORCE" == true ) ]]; then
  [[ -n "$LICENSE_KEY" ]] || fail "Set LUTIC_LICENSE_KEY or pass --license-key"
fi

if [[ "$DRY_RUN" == true ]]; then
  printf '[dry-run] %s with deployment configuration at %s\n' "$ACTION" "$ENV_FILE"
  if [[ "$ACTION" == activate || ( "$ACTION" == up && "$LICENSE_ENFORCE" == true ) ]]; then
    printf '[dry-run] Would check the configured license at %s/api/licenses/activate\n' "$(host_license_url)"
  fi
  if [[ "$ACTION" == bootstrap ]]; then
    printf '[dry-run] Would run lutic-paas bootstrap (packages/core/src/db/bootstrap.ts)\n'
  fi
  if [[ "$ACTION" == up || "$ACTION" == status ]]; then
    printf '[dry-run] Would check %s\n' "$HEALTH_URL"
  fi
  exit 0
fi

case "$ACTION" in
  prepare) prepare_env ;;
  activate) verify_license_online ;;
  *)
    [[ -f "$ENV_FILE" ]] || fail "Deployment configuration is missing. Run bash deploy/lutic.sh prepare."
    case "$ACTION" in
      bootstrap)
        compose_cmd run --rm -T \
          -e LUTIC_TENANT_NAME -e LUTIC_PLANT_NAME -e LUTIC_ADMIN_EMAIL -e LUTIC_ADMIN_PASSWORD \
          lutic-paas bun packages/core/src/db/bootstrap.ts
        ;;
      up)
        if [[ "$LICENSE_ENFORCE" == true ]]; then
          verify_license_online
          export LUTIC_LICENSE_KEY="$LICENSE_KEY" LICENSE_SERVER_URL="$LICENSE_SERVER"
        fi
        compose_cmd up -d --build
        printf 'Waiting for %s\n' "$HEALTH_URL"
        for _ in {1..60}; do
          if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
            printf 'Lutic PaaS is live at http://127.0.0.1:%s\n' "$LUTIC_PORT"
            exit 0
          fi
          sleep 2
        done
        fail "Lutic PaaS did not become healthy. Check bash deploy/lutic.sh logs."
        ;;
      status) compose_cmd ps; curl -fsS --max-time 3 "$HEALTH_URL"; printf '\n' ;;
      logs) compose_cmd logs -f lutic-paas ;;
      down) compose_cmd down ;;
    esac
    ;;
esac
