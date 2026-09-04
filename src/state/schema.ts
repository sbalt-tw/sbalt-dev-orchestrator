/**
 * Schema migrations.
 *
 * Migrations are ordered, applied inside a transaction, and recorded in
 * `schema_migrations`. The SQL lives in TypeScript so a built `dist/` needs no
 * companion .sql files at runtime.
 *
 * Version 1 is the original shape and is never edited. Version 2 rebuilds every
 * table that persists an enum so the database itself refuses an
 * out-of-vocabulary value, and adds the two columns that make multi-target
 * transitions deterministic. Hardening version 1 in place would have been
 * simpler and wrong: a database created by an earlier build would have stayed
 * unconstrained forever while the code claimed otherwise.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
  /**
   * True when the migration drops and recreates tables. The runner then
   * disables foreign keys around the transaction and verifies
   * `foreign_key_check` before committing.
   */
  rebuildsTables?: boolean;
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
  {
    version: 2,
    name: 'constrain_enums_and_deterministic_targets',
    rebuildsTables: true,
    sql: `
-- Rebuilds every table that persists an enum so the database itself refuses an
-- out-of-vocabulary value, and adds the columns that make two multi-target
-- transitions deterministic.
--
-- Written as a migration rather than an edit to version 1 so a database created
-- by an earlier build converges on the same shape. Editing version 1 in place
-- would have left any existing database permanently unconstrained while the
-- code claimed otherwise.
--
-- SQLite cannot add a CHECK constraint to an existing table, so each table is
-- rebuilt: create the constrained shape, copy, drop, rename, recreate indexes.

-- Foreign keys are disabled by the runner around this transaction, and
-- foreign_key_check runs before the commit. A PRAGMA here would be ignored.

-- ------------------------------------------------------------------- lanes
CREATE TABLE lanes_new (
  id                              TEXT PRIMARY KEY,
  project_id                      TEXT NOT NULL REFERENCES projects(id),
  name                            TEXT NOT NULL,
  risk_class                      TEXT NOT NULL CHECK (risk_class IN ('LOW','STANDARD','HIGH')),
  max_active_implementation_prs   INTEGER NOT NULL CHECK (max_active_implementation_prs > 0),
  status                          TEXT NOT NULL CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
  created_at                      TEXT NOT NULL,
  UNIQUE (project_id, name)
);
INSERT INTO lanes_new SELECT id, project_id, name, risk_class, max_active_implementation_prs, status, created_at FROM lanes;
DROP TABLE lanes;
ALTER TABLE lanes_new RENAME TO lanes;

-- ------------------------------------------------------------------- tasks
CREATE TABLE tasks_new (
  id                     TEXT PRIMARY KEY,
  lane_id                TEXT NOT NULL REFERENCES lanes(id),
  title                  TEXT NOT NULL,
  task_type              TEXT NOT NULL CHECK (task_type IN ('IMPLEMENTATION','DOCS','REVIEW_FIX','INVESTIGATION','DEPLOYMENT')),
  state                  TEXT NOT NULL CHECK (state IN ('QUEUED','READY','RUNNING','WAITING_DEPENDENCY','WAITING_CI','WAITING_REVIEW','REVIEW_FIX','FOUNDER_DECISION','BLOCKED_INFRA','BLOCKED_POLICY','READY_TO_MERGE','DONE','CANCELLED')),
  risk_class             TEXT NOT NULL CHECK (risk_class IN ('LOW','STANDARD','HIGH')),
  priority               INTEGER NOT NULL DEFAULT 0,
  requires_pr            INTEGER NOT NULL DEFAULT 1 CHECK (requires_pr IN (0,1)),
  required_resources     TEXT NOT NULL DEFAULT '[]',
  required_capabilities  TEXT NOT NULL DEFAULT '[]',
  pr_number              INTEGER,
  pr_base_sha            TEXT,
  pr_head_sha            TEXT,
  ci_status              TEXT NOT NULL DEFAULT 'NONE' CHECK (ci_status IN ('NONE','PENDING','PASSED','FAILED')),
  review_max_rounds      INTEGER,
  -- Where the task was when infrastructure failed, so RECOVERED has a
  -- deterministic destination instead of a caller-chosen one.
  pre_infra_state        TEXT CHECK (pre_infra_state IS NULL OR pre_infra_state IN ('QUEUED','READY','RUNNING','WAITING_DEPENDENCY','WAITING_CI','WAITING_REVIEW','REVIEW_FIX','FOUNDER_DECISION','BLOCKED_INFRA','BLOCKED_POLICY','READY_TO_MERGE','DONE','CANCELLED')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
INSERT INTO tasks_new (id, lane_id, title, task_type, state, risk_class, priority, requires_pr,
                       required_resources, required_capabilities, pr_number, pr_base_sha, pr_head_sha,
                       ci_status, review_max_rounds, pre_infra_state, created_at, updated_at)
SELECT id, lane_id, title, task_type, state, risk_class, priority, requires_pr,
       required_resources, required_capabilities, pr_number, pr_base_sha, pr_head_sha,
       ci_status, review_max_rounds, NULL, created_at, updated_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_lane  ON tasks(lane_id);
CREATE INDEX idx_tasks_state ON tasks(state);

-- ------------------------------------------------------ task_dependencies
CREATE TABLE task_dependencies_new (
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id),
  required_state     TEXT NOT NULL DEFAULT 'DONE' CHECK (required_state IN ('QUEUED','READY','RUNNING','WAITING_DEPENDENCY','WAITING_CI','WAITING_REVIEW','REVIEW_FIX','FOUNDER_DECISION','BLOCKED_INFRA','BLOCKED_POLICY','READY_TO_MERGE','DONE','CANCELLED')),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
INSERT INTO task_dependencies_new SELECT task_id, depends_on_task_id, required_state FROM task_dependencies;
DROP TABLE task_dependencies;
ALTER TABLE task_dependencies_new RENAME TO task_dependencies;

-- ----------------------------------------------------------------- workers
CREATE TABLE workers_new (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  capabilities  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL CHECK (status IN ('IDLE','BUSY','OFFLINE')),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
INSERT INTO workers_new SELECT id, provider, capabilities, status, created_at, last_seen_at FROM workers;
DROP TABLE workers;
ALTER TABLE workers_new RENAME TO workers;

-- ---------------------------------------------------------- worker_leases
CREATE TABLE worker_leases_new (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  worker_id     TEXT NOT NULL REFERENCES workers(id),
  started_at    TEXT NOT NULL,
  heartbeat_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','STALE'))
);
INSERT INTO worker_leases_new SELECT id, task_id, worker_id, started_at, heartbeat_at, expires_at, status FROM worker_leases;
DROP TABLE worker_leases;
ALTER TABLE worker_leases_new RENAME TO worker_leases;
CREATE INDEX idx_worker_leases_task   ON worker_leases(task_id);
CREATE INDEX idx_worker_leases_status ON worker_leases(status);
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_task
  ON worker_leases(task_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX idx_worker_leases_one_active_per_worker
  ON worker_leases(worker_id) WHERE status = 'ACTIVE';

-- --------------------------------------------------------------- resources
-- A gated resource must name the category that authorises it, and a category
-- without the flag reads as protection that is not applied. Both directions are
-- constrained so a directly seeded row cannot end up ungated.
CREATE TABLE resources_new (
  name             TEXT PRIMARY KEY,
  capacity         INTEGER NOT NULL CHECK (capacity >= 0),
  founder_required INTEGER NOT NULL DEFAULT 0 CHECK (founder_required IN (0,1)),
  -- 'legacy_unknown' is deliberately not a decision category. A resource
  -- carrying it can never be authorised, because no decision can ever match it.
  founder_category TEXT CHECK (founder_category IS NULL OR founder_category IN ('architecture_change','product_semantics_change','review_budget_extension','staging_write','production_write','destructive_operation','rollback','merge','legacy_unknown')),
  CHECK ((founder_required = 1 AND founder_category IS NOT NULL)
      OR (founder_required = 0 AND founder_category IS NULL))
);
-- A v1 gated resource records no category. Inventing one would be a security
-- guess: assigning 'production_write' to a row that actually guarded a
-- destructive operation would let a production approval authorise a rollback.
-- Only the two names whose meaning is fixed are mapped; every other gated
-- resource becomes 'legacy_unknown' and cannot be leased until an operator
-- states what it guards.
INSERT INTO resources_new (name, capacity, founder_required, founder_category)
SELECT name, capacity, founder_required,
       CASE
         WHEN name = 'staging-write' THEN 'staging_write'
         WHEN name = 'production-write' THEN 'production_write'
         WHEN founder_required = 1 THEN 'legacy_unknown'
         ELSE NULL
       END
FROM resources;
-- The remote-write names are gated by identity, whatever the old row said.
UPDATE resources_new SET founder_required = 1 WHERE name IN ('staging-write','production-write');
DROP TABLE resources;
ALTER TABLE resources_new RENAME TO resources;

-- --------------------------------------------------------- resource_leases
CREATE TABLE resource_leases_new (
  id             TEXT PRIMARY KEY,
  resource_name  TEXT NOT NULL REFERENCES resources(name),
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  worker_id      TEXT,
  acquired_at    TEXT NOT NULL,
  expires_at     TEXT,
  status         TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','STALE'))
);
INSERT INTO resource_leases_new SELECT id, resource_name, task_id, worker_id, acquired_at, expires_at, status FROM resource_leases;
DROP TABLE resource_leases;
ALTER TABLE resource_leases_new RENAME TO resource_leases;
CREATE INDEX idx_resource_leases_resource ON resource_leases(resource_name, status);
CREATE UNIQUE INDEX idx_resource_leases_one_active_per_task_resource
  ON resource_leases(resource_name, task_id) WHERE status = 'ACTIVE';

-- --------------------------------------------------------- review_attempts
CREATE TABLE review_attempts_new (
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
  status       TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED_VERDICT','INFRA_ABORTED')),
  created_at   TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO review_attempts_new SELECT id, task_id, reviewer, round, base_sha, head_sha, blocker, high, medium, low, status, created_at, completed_at FROM review_attempts;
DROP TABLE review_attempts;
ALTER TABLE review_attempts_new RENAME TO review_attempts;
CREATE INDEX idx_review_attempts_task ON review_attempts(task_id);

-- ------------------------------------------------------- founder_decisions
CREATE TABLE founder_decisions_new (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id),
  category    TEXT NOT NULL CHECK (category IN ('architecture_change','product_semantics_change','review_budget_extension','staging_write','production_write','destructive_operation','rollback','merge')),
  question    TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('REQUIRED','RESOLVED','WITHDRAWN')),
  -- What the Founder actually decided. Authorization is read from here, never
  -- from the mere fact that a row reached RESOLVED: an approval and a refusal
  -- are both resolutions, and treating them alike let a denial authorise work.
  outcome     TEXT CHECK (
                (state = 'REQUIRED'  AND outcome IS NULL) OR
                (state = 'WITHDRAWN' AND outcome IS NULL) OR
                (state = 'RESOLVED'  AND outcome IN ('APPROVED','DENIED','CANCELLED'))
              ),
  resolution  TEXT,
  -- What the answer asked for, kept for the audit trail. The engine does not
  -- take the destination from a single row; see StateEngine.
  resolved_target TEXT CHECK (resolved_target IS NULL OR resolved_target IN ('QUEUED','READY','REVIEW_FIX','READY_TO_MERGE','BLOCKED_POLICY','CANCELLED')),
  provenance  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
-- A v1 row that reached RESOLVED carries no record of what was decided. It is
-- migrated as an explicit APPROVED only where the original code could only have
-- meant approval; anything else becomes WITHDRAWN, which authorises nothing.
INSERT INTO founder_decisions_new (id, task_id, category, question, state, outcome, resolution, resolved_target, provenance, created_at, resolved_at)
SELECT id, task_id, category, question,
       CASE WHEN state IN ('REQUIRED','RESOLVED','WITHDRAWN') THEN state ELSE 'WITHDRAWN' END,
       CASE WHEN state = 'RESOLVED' THEN 'APPROVED' ELSE NULL END,
       resolution, NULL, provenance, created_at, resolved_at
FROM founder_decisions;
DROP TABLE founder_decisions;
ALTER TABLE founder_decisions_new RENAME TO founder_decisions;
CREATE INDEX idx_founder_decisions_task  ON founder_decisions(task_id);
CREATE INDEX idx_founder_decisions_state ON founder_decisions(state);

`,
  },
];
