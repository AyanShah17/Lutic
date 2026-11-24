#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'EOF'
Lutic PostgreSQL Encrypted Backup & Isolated Restore Verification

Usage:
  bash deploy/backup-restore.sh backup --output <file.dump> [--db-url <url>] [--encrypt] [--dry-run]
  bash deploy/backup-restore.sh restore-verify --input <file.dump[.enc]> --target-db-url <isolated_url> [--allow-overwrite] [--dry-run]

Environment:
  DATABASE_URL                Source PostgreSQL URL (for backup when --db-url is omitted)
  BACKUP_PASSPHRASE           Passphrase for OpenSSL AES-256-CBC backup encryption/decryption
  CREDENTIAL_ENCRYPTION_KEY   Fallback passphrase if BACKUP_PASSPHRASE is unset and --encrypt is used
EOF
}

cmd="${1:-}"
if [[ -z "$cmd" || "$cmd" == "--help" || "$cmd" == "-h" ]]; then
  usage
  exit 0
fi
shift

output_file=""
input_file=""
db_url_arg=""
db_url="${DATABASE_URL:-}"
target_db_url=""
encrypt="false"
dry_run="false"
allow_overwrite="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="${2:-}"
      shift 2
      ;;
    --input)
      input_file="${2:-}"
      shift 2
      ;;
    --db-url)
      db_url_arg="${2:-}"
      db_url="${2:-}"
      shift 2
      ;;
    --target-db-url)
      target_db_url="${2:-}"
      shift 2
      ;;
    --encrypt)
      encrypt="true"
      shift
      ;;
    --allow-overwrite)
      allow_overwrite="true"
      shift
      ;;
    --dry-run)
      dry_run="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

validate_isolated_target_db() {
  LUTIC_ROOT_DIR="$ROOT_DIR" \
  LUTIC_TARGET_DB_URL="$target_db_url" \
  LUTIC_LIVE_DB_URL="${DATABASE_URL:-}" \
  LUTIC_ARG_DB_URL="$db_url_arg" \
  bun -e '
    import fs from "node:fs";
    import path from "node:path";

    function canonicalizeTargetUrl(raw) {
      if (typeof raw !== "string" || !raw) return null;
      if (raw.startsWith("pglite://")) {
        const stripped = raw.slice("pglite://".length);
        if (!stripped || stripped === "memory") return null;
        const rootDir = process.env.LUTIC_ROOT_DIR || process.cwd();
        const resolved = path.resolve(rootDir, stripped);
        const dbName = path.basename(resolved).trim().toLowerCase();
        if (!dbName) return null;
        return { key: `pglite:${resolved.toLowerCase()}`, dbName };
      }
      let url;
      try {
        url = new URL(raw);
      } catch {
        return null;
      }
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        return null;
      }
      const dbName = decodeURIComponent(url.pathname.replace(/^\/+/, "")).trim().toLowerCase();
      if (!url.hostname || !dbName) return null;
      let host = url.hostname.toLowerCase();
      if (host === "localhost" || host === "::1" || host === "[::1]") {
        host = "127.0.0.1";
      }
      const port = url.port || "5432";
      return { key: `${host}:${port}/${dbName}`, dbName };
    }

    function readEnvDatabaseUrls(filePaths) {
      const found = [];
      for (const filePath of filePaths) {
        if (!fs.existsSync(filePath)) continue;
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const match = /^DATABASE_URL\s*=\s*(.*)$/.exec(trimmed);
          if (!match) continue;
          let value = match[1].trim();
          if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("\x27") && value.endsWith("\x27"))) {
            value = value.slice(1, -1);
          }
          if (value) found.push(value);
        }
      }
      return found;
    }

    const target = canonicalizeTargetUrl(process.env.LUTIC_TARGET_DB_URL || "");
    if (!target) {
      console.error("Invalid --target-db-url; expected a postgres://, postgresql://, or pglite:// URL with a database name.");
      process.exit(1);
    }

    const rootDir = process.env.LUTIC_ROOT_DIR || process.cwd();
    const envFiles = [...new Set([
      path.resolve(rootDir, ".env.production"),
      path.resolve(rootDir, ".env"),
      path.resolve(process.cwd(), ".env.production"),
      path.resolve(process.cwd(), ".env")
    ])];

    const liveCandidates = [
      process.env.LUTIC_LIVE_DB_URL,
      process.env.LUTIC_ARG_DB_URL,
      ...readEnvDatabaseUrls(envFiles)
    ].filter(Boolean);

    for (const candidate of liveCandidates) {
      const parsed = canonicalizeTargetUrl(candidate);
      if (parsed && parsed.key === target.key) {
        console.error("Refusing restore-verify against live or configured DATABASE_URL; provide an isolated database.");
        process.exit(1);
      }
    }

    const reservedNames = new Set(["lutic", "postgres"]);
    if (reservedNames.has(target.dbName) || !/(restore|verify|test|tmp|drill|isolated)/i.test(target.dbName)) {
      console.error("Refusing restore-verify: target database name must indicate an isolated restore/verify/test database.");
      process.exit(1);
    }
  '
}

passphrase="${BACKUP_PASSPHRASE:-${CREDENTIAL_ENCRYPTION_KEY:-}}"

if [[ "$cmd" == "backup" ]]; then
  if [[ -z "$output_file" ]]; then
    echo "Missing --output <file>" >&2
    exit 1
  fi
  if [[ -z "$db_url" && "$dry_run" != "true" ]]; then
    echo "Missing --db-url or DATABASE_URL" >&2
    exit 1
  fi
  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] Would run pg_dump -Fc -> $output_file (encrypt=$encrypt)"
    exit 0
  fi

  mkdir -p "$(dirname "$output_file")"
  tmp_dump="${output_file}.tmp.$$"
  trap 'rm -f "$tmp_dump"' EXIT
  pg_dump -Fc -f "$tmp_dump" "$db_url"

  if [[ "$encrypt" == "true" ]]; then
    if [[ -z "$passphrase" ]]; then
      echo "BACKUP_PASSPHRASE or CREDENTIAL_ENCRYPTION_KEY is required when --encrypt is enabled." >&2
      exit 1
    fi
    enc_out="$output_file"
    if [[ "$enc_out" != *.enc ]]; then
      enc_out="${output_file}.enc"
    fi
    LUTIC_BACKUP_PASS="$passphrase" openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -in "$tmp_dump" -out "$enc_out" -pass env:LUTIC_BACKUP_PASS
    rm -f "$tmp_dump"
    echo "Encrypted backup written to $enc_out"
  else
    mv "$tmp_dump" "$output_file"
    echo "Backup written to $output_file"
  fi
  exit 0
fi

if [[ "$cmd" == "restore-verify" ]]; then
  if [[ -z "$input_file" || -z "$target_db_url" ]]; then
    echo "restore-verify requires --input and --target-db-url" >&2
    exit 1
  fi
  validate_isolated_target_db
  if [[ "$dry_run" == "true" ]]; then
    echo "[dry-run] Would restore $input_file into isolated target DB and run Lutic schema/migration verification"
    exit 0
  fi
  if [[ ! -f "$input_file" ]]; then
    echo "Backup file not found: $input_file" >&2
    exit 1
  fi

  if [[ "$allow_overwrite" != "true" ]]; then
    DATABASE_URL="$target_db_url" LUTIC_CORE_ENTRY="${ROOT_DIR}/packages/core/src/index.ts" bun -e '
      const { createDbConnection, sql } = await import(process.env.LUTIC_CORE_ENTRY);
      const conn = await createDbConnection();
      try {
        const regRes = await conn.db.execute(sql`SELECT to_regclass(\x27public.tenants\x27) IS NOT NULL AS exists`);
        const rawExists = regRes?.rows?.[0]?.exists;
        const exists = rawExists === true || rawExists === "t";
        if (exists) {
          const cntRes = await conn.db.execute(sql`SELECT count(*)::int AS cnt FROM public.tenants`);
          const cnt = Number(cntRes?.rows?.[0]?.cnt ?? 0);
          if (cnt > 0) {
            console.error("Refusing destructive restore-verify into a non-empty database without --allow-overwrite.");
            process.exit(1);
          }
        }
      } finally {
        await conn.close();
      }
    '
  fi

  restore_src="$input_file"
  tmp_dec=""
  trap '[[ -n "$tmp_dec" ]] && rm -f "$tmp_dec"' EXIT
  if [[ "$input_file" == *.enc ]]; then
    if [[ -z "$passphrase" ]]; then
      echo "BACKUP_PASSPHRASE or CREDENTIAL_ENCRYPTION_KEY is required to decrypt .enc backup." >&2
      exit 1
    fi
    tmp_dec="$(mktemp)"
    LUTIC_BACKUP_PASS="$passphrase" openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -in "$input_file" -out "$tmp_dec" -pass env:LUTIC_BACKUP_PASS
    restore_src="$tmp_dec"
  fi

  pg_restore --clean --if-exists --no-owner --no-acl -d "$target_db_url" "$restore_src"
  DATABASE_URL="$target_db_url" LUTIC_CORE_ENTRY="${ROOT_DIR}/packages/core/src/index.ts" bun -e '
    const { createDbConnection, ensureSchema, getAppliedMigrations } = await import(process.env.LUTIC_CORE_ENTRY);
    const conn = await createDbConnection();
    try {
      await ensureSchema(conn);
      const migrations = await getAppliedMigrations(conn);
      console.log("Restored and verified migrations:", JSON.stringify(migrations.map((m) => m.version)));
    } finally {
      await conn.close();
    }
  '
  echo "Isolated restore verification succeeded."
  exit 0
fi

echo "Unknown command: $cmd" >&2
usage >&2
exit 1
