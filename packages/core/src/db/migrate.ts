import crypto from "node:crypto";
import { createDbConnection, getDbConnection, type DbConnection } from "./client";

export interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

export interface AppliedMigrationRecord {
  version: number;
  name: string;
  checksum: string;
  appliedAt: string;
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  location TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS plants_tenant_idx ON plants(tenant_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email_idx ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS user_plants (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, plant_id)
);
CREATE INDEX IF NOT EXISTS user_plants_tenant_idx ON user_plants(tenant_id);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  machine_type TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial_no TEXT NOT NULL DEFAULT '',
  install_date TEXT NOT NULL DEFAULT '',
  criticality TEXT NOT NULL DEFAULT 'B',
  qr_code TEXT NOT NULL DEFAULT '',
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS assets_tenant_plant_idx ON assets(tenant_id, plant_id);
CREATE INDEX IF NOT EXISTS assets_parent_idx ON assets(parent_id);

CREATE TABLE IF NOT EXISTS machine_status (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  current_speed DOUBLE PRECISION NOT NULL DEFAULT 0,
  temperature DOUBLE PRECISION NOT NULL DEFAULT 0,
  vibration DOUBLE PRECISION NOT NULL DEFAULT 0,
  pressure DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS machine_status_machine_idx ON machine_status(machine_id);

CREATE TABLE IF NOT EXISTS alarms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  raised_at TIMESTAMPTZ NOT NULL,
  cleared_at TIMESTAMPTZ,
  acknowledged_by TEXT
);
CREATE INDEX IF NOT EXISTS alarms_tenant_machine_idx ON alarms(tenant_id, machine_id);
CREATE INDEX IF NOT EXISTS alarms_raised_idx ON alarms(raised_at);

CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT 'good'
);
CREATE INDEX IF NOT EXISTS readings_machine_ts_idx ON readings(machine_id, ts);
CREATE INDEX IF NOT EXISTS readings_tenant_tag_idx ON readings(tenant_id, tag);

CREATE TABLE IF NOT EXISTS failure_modes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  iso_code TEXT NOT NULL,
  mode TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  cause TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS failure_modes_tenant_idx ON failure_modes(tenant_id);

CREATE TABLE IF NOT EXISTS fault_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  machine_type TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  standard_failure_mode TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fault_codes_tenant_code_idx ON fault_codes(tenant_id, code);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  component_id TEXT,
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  fault_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT '',
  parts_used JSONB DEFAULT '[]'::jsonb,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  technician TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS work_orders_tenant_machine_idx ON work_orders(tenant_id, machine_id);
CREATE INDEX IF NOT EXISTS work_orders_fault_idx ON work_orders(fault_code);
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_idemp_idx ON work_orders(tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  part_no TEXT NOT NULL,
  description TEXT NOT NULL,
  compatible_machine_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  bom_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  unit_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS parts_tenant_partno_idx ON parts(tenant_id, part_no);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  min_level INTEGER NOT NULL DEFAULT 1,
  location TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL DEFAULT 5
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_part_plant_idx ON inventory(part_id, plant_id);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  line_id TEXT NOT NULL,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  shift TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  planned_time_min DOUBLE PRECISION NOT NULL,
  run_time_min DOUBLE PRECISION NOT NULL,
  good_count INTEGER NOT NULL,
  scrap_count INTEGER NOT NULL,
  ideal_cycle_time_sec DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS production_runs_tenant_ts_idx ON production_runs(tenant_id, started_at);

CREATE TABLE IF NOT EXISTS quality_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES production_runs(id) ON DELETE SET NULL,
  ts TIMESTAMPTZ NOT NULL,
  defect_type TEXT NOT NULL,
  scrap_count INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS quality_events_tenant_ts_idx ON quality_events(tenant_id, ts);

CREATE TABLE IF NOT EXISTS downtime_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL,
  duration_min DOUBLE PRECISION NOT NULL,
  reason_code TEXT NOT NULL,
  category TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS downtime_events_tenant_start_idx ON downtime_events(tenant_id, start);

CREATE TABLE IF NOT EXISTS energy_readings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  kwh DOUBLE PRECISION NOT NULL,
  peak_kw DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS energy_readings_tenant_ts_idx ON energy_readings(tenant_id, ts);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  machine_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision TEXT NOT NULL,
  status TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  source TEXT NOT NULL,
  ingestion_status TEXT NOT NULL DEFAULT 'completed',
  ingestion_error TEXT,
  raw_content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS documents_tenant_status_idx ON documents(tenant_id, status);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page INTEGER NOT NULL DEFAULT 1,
  section_path TEXT NOT NULL DEFAULT 'Overview',
  text TEXT NOT NULL,
  embedding vector(64) NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', section_path || ' ' || text)) STORED,
  fault_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  part_numbers JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx ON document_chunks USING GIN(tsv);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id TEXT,
  title TEXT NOT NULL,
  share_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  citations JSONB DEFAULT '[]'::jsonb,
  charts JSONB DEFAULT '[]'::jsonb,
  safety_warning TEXT,
  pending_action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL,
  outcome TEXT,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feedback_tenant_msg_idx ON feedback(tenant_id, message_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  plant_scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  spec JSONB NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  is_template BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dashboards_tenant_idx ON dashboards(tenant_id);

CREATE TABLE IF NOT EXISTS dashboard_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  spec JSONB NOT NULL,
  created_by TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_versions_uniq ON dashboard_versions(dashboard_id, version);

CREATE TABLE IF NOT EXISTS dashboard_shares (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  share_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dashboard_shares_dash_idx ON dashboard_shares(dashboard_id);

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'healthy',
  last_sync_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  encrypted_credentials TEXT NOT NULL DEFAULT '',
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS connectors_tenant_kind_idx ON connectors(tenant_id, kind);

CREATE TABLE IF NOT EXISTS toolkits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS toolkits_tenant_name_idx ON toolkits(tenant_id, name);

CREATE TABLE IF NOT EXISTS toolkit_tools (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  toolkit_id TEXT NOT NULL REFERENCES toolkits(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS toolkit_tools_uniq ON toolkit_tools(tenant_id, toolkit_id, tool_name);

CREATE TABLE IF NOT EXISTS role_toolkits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  toolkit_id TEXT NOT NULL REFERENCES toolkits(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS role_toolkits_uniq ON role_toolkits(tenant_id, role, toolkit_id);

CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_idemp_idx ON pending_actions(tenant_id, idempotency_key);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  conversation_id TEXT,
  action TEXT NOT NULL DEFAULT 'tool_call',
  tool_name TEXT NOT NULL,
  args JSONB DEFAULT '{}'::jsonb,
  result_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_ts_idx ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_tool_status_idx ON audit_log(tool_name, status);

CREATE TABLE IF NOT EXISTS usage_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  conversation_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_log_tenant_ts_idx ON usage_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT REFERENCES plants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  definition JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflows_tenant_idx ON workflows(tenant_id);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition JSONB NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_versions_uniq ON workflow_versions(workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  triggered_by TEXT NOT NULL DEFAULT 'system',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  step_traces JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_wf_idx ON workflow_runs(tenant_id, workflow_id, started_at);

CREATE TABLE IF NOT EXISTS connector_connections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  transport TEXT NOT NULL DEFAULT 'simulated',
  endpoint_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  encrypted_credentials TEXT NOT NULL DEFAULT '',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  discovered_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_connections_tenant_slug_idx ON connector_connections(tenant_id, slug);

CREATE TABLE IF NOT EXISTS connector_triggers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connector_triggers_conn_idx ON connector_triggers(tenant_id, connection_id);

CREATE TABLE IF NOT EXISTS connector_sync_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL,
  records_synced INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connector_sync_logs_conn_ts_idx ON connector_sync_logs(tenant_id, connection_id, created_at);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS topics_tenant_name_idx ON topics(tenant_id, name);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  filter_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS subscriptions_topic_idx ON subscriptions(tenant_id, topic_id);

CREATE TABLE IF NOT EXISTS queues (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility_timeout_sec INTEGER NOT NULL DEFAULT 30,
  max_receive_count INTEGER NOT NULL DEFAULT 3,
  dead_letter_queue_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS queues_tenant_name_idx ON queues(tenant_id, name);

CREATE TABLE IF NOT EXISTS queue_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  body JSONB NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  receive_count INTEGER NOT NULL DEFAULT 0,
  receipt_handle TEXT,
  visible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS queue_messages_queue_status_idx ON queue_messages(tenant_id, queue_id, status, visible_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'in_app',
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_user_idx ON notifications(tenant_id, user_id, read, created_at);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT REFERENCES plants(id) ON DELETE SET NULL,
  machine_id TEXT REFERENCES assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metric_tag TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT 'gt',
  threshold DOUBLE PRECISION NOT NULL,
  severity TEXT NOT NULL DEFAULT 'high',
  evaluation_window_min INTEGER NOT NULL DEFAULT 5,
  state TEXT NOT NULL DEFAULT 'OK',
  notify_topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS alert_rules_tenant_idx ON alert_rules(tenant_id, enabled);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  plant_id TEXT REFERENCES plants(id) ON DELETE SET NULL,
  machine_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'ALARM',
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metric_tag TEXT NOT NULL DEFAULT '',
  metric_value DOUBLE PRECISION,
  threshold DOUBLE PRECISION,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alert_events_tenant_status_idx ON alert_events(tenant_id, status, triggered_at);

CREATE TABLE IF NOT EXISTS license_state (
  id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL DEFAULT '',
  server_url TEXT NOT NULL DEFAULT '',
  instance_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unactivated',
  plan TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS revoked_sessions_expiry_idx ON revoked_sessions(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  scope TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (scope, bucket_key)
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits(expires_at);
`;

const TENANT_RLS_TABLES = [
  "revoked_sessions",
  "tenants",
  "plants",
  "users",
  "user_plants",
  "assets",
  "machine_status",
  "alarms",
  "readings",
  "failure_modes",
  "fault_codes",
  "work_orders",
  "parts",
  "inventory",
  "production_runs",
  "quality_events",
  "downtime_events",
  "energy_readings",
  "documents",
  "document_chunks",
  "conversations",
  "messages",
  "feedback",
  "dashboards",
  "dashboard_versions",
  "dashboard_shares",
  "connectors",
  "toolkits",
  "toolkit_tools",
  "role_toolkits",
  "pending_actions",
  "audit_log",
  "usage_log",
  "workflows",
  "workflow_versions",
  "workflow_runs",
  "connector_connections",
  "connector_triggers",
  "connector_sync_logs",
  "topics",
  "subscriptions",
  "queues",
  "queue_messages",
  "notifications",
  "alert_rules",
  "alert_events",
  "ingestion_tokens",
  "board_issues"
];

const MIGRATION_0002_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ingestion_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["telemetry:write"]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  rotated_from_id TEXT,
  created_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ingestion_tokens_hash_idx ON ingestion_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ingestion_tokens_tenant_plant_idx ON ingestion_tokens(tenant_id, plant_id);
`;

const MIGRATION_0003_SQL = `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS external_auth_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_external_auth_id_idx
  ON users(external_auth_id) WHERE external_auth_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS board_issues (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plant_id TEXT REFERENCES plants(id) ON DELETE SET NULL,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  category TEXT NOT NULL DEFAULT 'operations',
  assignee_name TEXT NOT NULL DEFAULT '',
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ref TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS board_issues_tenant_identifier_idx ON board_issues(tenant_id, identifier);
CREATE INDEX IF NOT EXISTS board_issues_tenant_status_idx ON board_issues(tenant_id, status);
`;

const MIGRATION_0004_SQL = `
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS dense_embedding vector(1536);
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'local-deterministic-64';
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS document_chunks_dense_hnsw_idx
    ON document_chunks USING hnsw (dense_embedding vector_cosine_ops)
    WHERE dense_embedding IS NOT NULL;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_tick_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_tick_duration_ms INTEGER NOT NULL DEFAULT 0,
  tick_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  summary JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const MIGRATIONS: ReadonlyArray<MigrationDefinition> = [
  { version: 1, name: "0001_baseline_schema", sql: SCHEMA_SQL },
  { version: 2, name: "0002_account_lifecycle_and_ingestion_tokens", sql: MIGRATION_0002_SQL },
  { version: 3, name: "0003_clerk_identity_and_board_issues", sql: MIGRATION_0003_SQL },
  { version: 4, name: "0004_dense_embeddings_and_worker_heartbeats", sql: MIGRATION_0004_SQL }
];

function migrationChecksum(sqlText: string): string {
  return crypto.createHash("sha256").update(sqlText).digest("hex");
}

function buildRlsSql(): string {
  const roleSetup = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lutic_app') THEN
    CREATE ROLE lutic_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'lutic_app' AND (rolcanlogin OR rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'lutic_app must be a NOLOGIN, NOSUPERUSER, NOBYPASSRLS role';
  END IF;
END
$$;
GRANT lutic_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO lutic_app;
REVOKE ALL ON license_state FROM lutic_app;
REVOKE ALL ON schema_migrations FROM lutic_app;
REVOKE ALL ON worker_heartbeats FROM lutic_app;
REVOKE INSERT, UPDATE, DELETE ON tenants FROM lutic_app;
GRANT SELECT ON tenants TO lutic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ${TENANT_RLS_TABLES.filter((table) => table !== "tenants").join(", ")}, rate_limits TO lutic_app;
`;
  const blocks = TENANT_RLS_TABLES.map((tbl) => {
    const tenantColumn = tbl === "tenants" ? "id" : "tenant_id";
    const scope = `${tenantColumn} = NULLIF(current_setting('app.current_tenant_id', true), '')`;
    return `
ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${tbl} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_${tbl} ON ${tbl};
CREATE POLICY tenant_isolation_${tbl} ON ${tbl} TO lutic_app
  USING (${scope}) WITH CHECK (${scope});
DROP POLICY IF EXISTS tenant_administration ON ${tbl};
CREATE POLICY tenant_administration ON ${tbl} TO CURRENT_USER
  USING (current_user <> 'lutic_app');
`;
  });
  return roleSetup + blocks.join("\n");
}

export async function ensureSchema(conn?: DbConnection): Promise<void> {
  const connection = conn ?? (await getDbConnection());
  if (!connection.withRawTransaction) {
    await connection.executeRaw(SCHEMA_MIGRATIONS_DDL);
    for (const migration of MIGRATIONS) {
      await connection.executeRaw(migration.sql);
    }
    await connection.executeRaw(buildRlsSql());
    return;
  }

  await connection.withRawTransaction(async (execute, queryRows) => {
    await queryRows("SELECT pg_advisory_xact_lock(hashtext('lutic.migrations'), 1)");
    await execute(SCHEMA_MIGRATIONS_DDL);
    const appliedRows = await queryRows<{ version: number; name: string; checksum: string }>(
      "SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC"
    );
    const appliedMap = new Map(appliedRows.map((row) => [Number(row.version), row]));

    for (const migration of MIGRATIONS) {
      const checksum = migrationChecksum(migration.sql);
      const existing = appliedMap.get(migration.version);
      if (existing) {
        if (existing.name !== migration.name || existing.checksum !== checksum) {
          throw new Error(
            `Applied migration v${migration.version} (${existing.name}) checksum mismatch`
          );
        }
        continue;
      }
      await execute(migration.sql);
      await queryRows(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, checksum]
      );
    }

    await execute(buildRlsSql());
  });
}

export async function getAppliedMigrations(conn?: DbConnection): Promise<AppliedMigrationRecord[]> {
  const connection = conn ?? (await getDbConnection());
  if (!connection.withRawTransaction) return [];
  return connection.withRawTransaction(async (_execute, queryRows) => {
    const rows = await queryRows<{
      version: number;
      name: string;
      checksum: string;
      applied_at: Date | string;
    }>("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC");
    return rows.map((row) => ({
      version: Number(row.version),
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at)
    }));
  });
}

const isCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("migrate.ts");

if (isCli) {
  createDbConnection()
    .then(async (conn) => {
      await ensureSchema(conn);
      console.log(`Schema & RLS policies applied (${conn.dialect})`);
      await conn.close();
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
