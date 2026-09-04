/**
 * Schema migrations.
 *
 * Migrations are ordered, applied inside a transaction, and recorded in
 * `schema_migrations`. The SQL lives in TypeScript so a built `dist/` needs no
 * companion .sql files at runtime.
 *
 * SQLite is the durable authority for all workflow state. JSON is used only for
 * exported reports and configuration, never as the system of record.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  adapter_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE lanes (
  id                              TEXT PRIMARY KEY,
  project_id                      TEXT NOT NULL REFERENCES projects(id),
  name                            TEXT NOT NULL,
  risk_class                      TEXT NOT NULL,
  max_active_implementation_prs   INTEGER NOT NULL,
  status                          TEXT NOT NULL,
  created_at                      TEXT NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE tasks (
  id                     TEXT PRIMARY KEY,
  lane_id                TEXT NOT NULL REFERENCES lanes(id),
  title                  TEXT NOT NULL,
  task_type              TEXT NOT NULL,
  state                  TEXT NOT NULL,
  risk_class             TEXT NOT NULL,
  priority               INTEGER NOT NULL DEFAULT 0,
  requires_pr            INTEGER NOT NULL DEFAULT 1,
  required_resources     TEXT NOT NULL DEFAULT '[]',
  required_capabilities  TEXT NOT NULL DEFAULT '[]',
  pr_number              INTEGER,
  pr_base_sha            TEXT,
  pr_head_sha            TEXT,
  ci_status              TEXT NOT NULL DEFAULT 'NONE',
  review_max_rounds      INTEGER,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX idx_tasks_lane  ON tasks(lane_id);
CREATE INDEX idx_tasks_state ON tasks(state);

CREATE TABLE task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  required_state     TEXT NOT NULL DEFAULT 'DONE',
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE TABLE workers (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  capabilities  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

CREATE TABLE worker_leases (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  started_at    TEXT NOT NULL,
  heartbeat_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL
);
CREATE INDEX idx_worker_leases_task   ON worker_leases(task_id);
CREATE INDEX idx_worker_leases_status ON worker_leases(status);
-- At most one ACTIVE lease per task, enforced by the database rather than by
-- application discipline, so a crash mid-dispatch cannot double-assign.
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_task
  ON worker_leases(task_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_worker
  ON worker_leases(worker_id) WHERE status = 'ACTIVE';

CREATE TABLE resources (
  name             TEXT PRIMARY KEY,
  capacity         INTEGER NOT NULL,
  founder_required INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE resource_leases (
  id             TEXT PRIMARY KEY,
  resource_name  TEXT NOT NULL REFERENCES resources(name),
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  worker_id      TEXT,
  acquired_at    TEXT NOT NULL,
  expires_at     TEXT,
  status         TEXT NOT NULL
);
CREATE INDEX idx_resource_leases_resource ON resource_leases(resource_name, status);
CREATE UNIQUE INDEX idx_resource_leases_one_active_per_task_resource
  ON resource_leases(resource_name, task_id) WHERE status = 'ACTIVE';

CREATE TABLE review_attempts (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  reviewer     TEXT NOT NULL,
  round        INTEGER NOT NULL,
  base_sha     TEXT NOT NULL,
  head_sha     TEXT NOT NULL,
  blocker      INTEGER NOT NULL DEFAULT 0,
  high         INTEGER NOT NULL DEFAULT 0,
  medium       INTEGER NOT NULL DEFAULT 0,
  low          INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_review_attempts_task ON review_attempts(task_id);

CREATE TABLE founder_decisions (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id),
  category    TEXT NOT NULL,
  question    TEXT NOT NULL,
  state       TEXT NOT NULL,
  resolution  TEXT,
  provenance  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX idx_founder_decisions_task  ON founder_decisions(task_id);
CREATE INDEX idx_founder_decisions_state ON founder_decisions(state);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  task_id     TEXT,
  event_type  TEXT NOT NULL,
  actor       TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  seq         INTEGER NOT NULL
);
CREATE INDEX idx_events_task ON events(task_id, seq);

CREATE TABLE worker_reports (
  id         TEXT PRIMARY KEY,
  task_id    TEXT,
  worker_id  TEXT,
  accepted   INTEGER NOT NULL,
  reason     TEXT,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_worker_reports_task ON worker_reports(task_id);
`,
  },
];
