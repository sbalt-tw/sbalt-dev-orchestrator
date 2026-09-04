/**
 * Durable store: the single writer of workflow state.
 *
 * Every mutation goes through here, and multi-row mutations are wrapped in a
 * SQLite transaction so a crash leaves the database on one side of the change
 * or the other. Callers never issue SQL directly.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { openDatabase } from './db.js';
import type {
  CiStatus,
  FounderDecision,
  FounderDecisionCategory,
  FounderDecisionState,
  HistoryEvent,
  Lane,
  LaneStatus,
  Project,
  ResourceDefinition,
  ResourceLease,
  ReviewAttempt,
  ReviewAttemptStatus,
  RiskClass,
  Task,
  TaskDependency,
  TaskType,
  Worker,
  WorkerLease,
  WorkerStatus,
} from '../domain/entities.js';
import { TASK_STATES, type TaskState } from '../domain/states.js';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface StoreOptions {
  dbPath?: string;
  clock?: Clock;
  idFactory?: () => string;
}

interface TaskRow {
  id: string;
  lane_id: string;
  title: string;
  task_type: string;
  state: string;
  risk_class: string;
  priority: number;
  requires_pr: number;
  required_resources: string;
  required_capabilities: string;
  pr_number: number | null;
  pr_base_sha: string | null;
  pr_head_sha: string | null;
  ci_status: string;
  review_max_rounds: number | null;
  pre_infra_state: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Runtime guard for a persisted task state.
 *
 * TypeScript types vanish at runtime, so a plain JavaScript caller could pass
 * any string. An unrecognised state would later fail to match the transition
 * table and crash instead of failing closed, so it is rejected here as well as
 * by the database CHECK constraint.
 */
export function assertTaskState(value: string): TaskState {
  if (!(TASK_STATES as readonly string[]).includes(value)) {
    throw new Error(`invalid task state: ${JSON.stringify(value)}`);
  }
  return value as TaskState;
}

function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export class Store {
  readonly db: Db;
  private readonly clock: Clock;
  private readonly idFactory: () => string;

  constructor(options: StoreOptions = {}) {
    this.db = openDatabase(options.dbPath);
    this.clock = options.clock ?? systemClock;
    this.idFactory = options.idFactory ?? (() => randomUUID());
  }

  close(): void {
    this.db.close();
  }

  now(): string {
    return this.clock.now().toISOString();
  }

  /**
   * The current time according to this store's clock.
   *
   * Everything that compares timestamps must go through here. Mixing an
   * injected clock with `new Date()` made lease expiry inconsistent: a store on
   * a test clock wrote an expiry the scheduler then judged against wall time,
   * and healthy leases were reconciled as stale.
   */
  nowDate(): Date {
    return this.clock.now();
  }

  newId(prefix: string): string {
    return `${prefix}_${this.idFactory()}`;
  }

  /** Run `fn` inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Run `fn` inside a BEGIN IMMEDIATE transaction.
   *
   * Used where a decision is made from a read and then committed — capacity
   * checks, concurrency ceilings, lane slots. A deferred transaction would let
   * two schedulers both read room and both commit; an immediate one takes the
   * write lock up front so the second waits and re-reads.
   */
  immediateTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  // ---------------------------------------------------------------- projects

  createProject(name: string, adapterId: string): Project {
    const project: Project = {
      id: this.newId('prj'),
      name,
      adapterId,
      createdAt: this.now(),
    };
    this.db
      .prepare('INSERT INTO projects (id, name, adapter_id, created_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.adapterId, project.createdAt);
    return project;
  }

  getProjectByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | { id: string; name: string; adapter_id: string; created_at: string }
      | undefined;
    return row ? { id: row.id, name: row.name, adapterId: row.adapter_id, createdAt: row.created_at } : null;
  }

  listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as Array<{
      id: string;
      name: string;
      adapter_id: string;
      created_at: string;
    }>;
    return rows.map((r) => ({ id: r.id, name: r.name, adapterId: r.adapter_id, createdAt: r.created_at }));
  }

  // ------------------------------------------------------------------- lanes

  createLane(input: {
    projectId: string;
    name: string;
    riskClass?: RiskClass;
    maxActiveImplementationPrs?: number;
  }): Lane {
    const lane: Lane = {
      id: this.newId('lane'),
      projectId: input.projectId,
      name: input.name,
      riskClass: input.riskClass ?? 'STANDARD',
      maxActiveImplementationPrs: input.maxActiveImplementationPrs ?? 1,
      status: 'ACTIVE',
      createdAt: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO lanes (id, project_id, name, risk_class, max_active_implementation_prs, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lane.id,
        lane.projectId,
        lane.name,
        lane.riskClass,
        lane.maxActiveImplementationPrs,
        lane.status,
        lane.createdAt,
      );
    return lane;
  }

  getLane(id: string): Lane | null {
    const row = this.db.prepare('SELECT * FROM lanes WHERE id = ?').get(id) as
      | {
          id: string;
          project_id: string;
          name: string;
          risk_class: string;
          max_active_implementation_prs: number;
          status: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      riskClass: row.risk_class as RiskClass,
      maxActiveImplementationPrs: row.max_active_implementation_prs,
      status: row.status as LaneStatus,
      createdAt: row.created_at,
    };
  }

  listLanes(): Lane[] {
    const rows = this.db.prepare('SELECT id FROM lanes ORDER BY created_at').all() as Array<{ id: string }>;
    return rows.map((r) => this.getLane(r.id)).filter((l): l is Lane => l !== null);
  }

  setLaneStatus(laneId: string, status: LaneStatus): void {
    this.db.prepare('UPDATE lanes SET status = ? WHERE id = ?').run(status, laneId);
  }

  // ------------------------------------------------------------------- tasks

  private mapTask(row: TaskRow): Task {
    return {
      id: row.id,
      laneId: row.lane_id,
      title: row.title,
      taskType: row.task_type as TaskType,
      state: row.state as TaskState,
      riskClass: row.risk_class as RiskClass,
      priority: row.priority,
      requiresPr: row.requires_pr === 1,
      requiredResources: parseStringArray(row.required_resources),
      requiredCapabilities: parseStringArray(row.required_capabilities),
      prNumber: row.pr_number,
      prBaseSha: row.pr_base_sha,
      prHeadSha: row.pr_head_sha,
      ciStatus: row.ci_status as CiStatus,
      reviewMaxRounds: row.review_max_rounds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createTask(input: {
    laneId: string;
    title: string;
    taskType: TaskType;
    riskClass?: RiskClass;
    priority?: number;
    requiresPr?: boolean;
    requiredResources?: string[];
    requiredCapabilities?: string[];
    reviewMaxRounds?: number | null;
    initialState?: TaskState;
  }): Task {
    const ts = this.now();
    const task: Task = {
      id: this.newId('task'),
      laneId: input.laneId,
      title: input.title,
      taskType: input.taskType,
      state: assertTaskState(input.initialState ?? 'QUEUED'),
      riskClass: input.riskClass ?? 'STANDARD',
      priority: input.priority ?? 0,
      requiresPr: input.requiresPr ?? true,
      requiredResources: input.requiredResources ?? [],
      requiredCapabilities: input.requiredCapabilities ?? [],
      prNumber: null,
      prBaseSha: null,
      prHeadSha: null,
      ciStatus: 'NONE',
      reviewMaxRounds: input.reviewMaxRounds ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, lane_id, title, task_type, state, risk_class, priority, requires_pr,
                            required_resources, required_capabilities, pr_number, pr_base_sha, pr_head_sha,
                            ci_status, review_max_rounds, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        task.id,
        task.laneId,
        task.title,
        task.taskType,
        task.state,
        task.riskClass,
        task.priority,
        task.requiresPr ? 1 : 0,
        JSON.stringify(task.requiredResources),
        JSON.stringify(task.requiredCapabilities),
        task.prNumber,
        task.prBaseSha,
        task.prHeadSha,
        task.ciStatus,
        task.reviewMaxRounds,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  requireTask(id: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    return task;
  }

  listTasks(filter: { laneId?: string; state?: TaskState } = {}): Task[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.laneId) {
      clauses.push('lane_id = ?');
      params.push(filter.laneId);
    }
    if (filter.state) {
      clauses.push('state = ?');
      params.push(filter.state);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at ASC`)
      .all(...params) as TaskRow[];
    return rows.map((r) => this.mapTask(r));
  }

  /**
   * Writes the new state.
   *
   * Intended for StateEngine only — it is the component that decides whether a
   * transition is legal, and this method deliberately performs no such check.
   * The value is validated regardless, so an out-of-vocabulary state can never
   * be persisted whatever calls it.
   */
  setTaskState(taskId: string, state: TaskState): void {
    this.db
      .prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?')
      .run(assertTaskState(state), this.now(), taskId);
  }

  /** Remember where a task was when infrastructure failed, so RECOVERED has a
   * deterministic destination rather than a caller-chosen one. */
  setPreInfraState(taskId: string, state: TaskState | null): void {
    this.db
      .prepare('UPDATE tasks SET pre_infra_state = ? WHERE id = ?')
      .run(state === null ? null : assertTaskState(state), taskId);
  }

  getPreInfraState(taskId: string): TaskState | null {
    const row = this.db.prepare('SELECT pre_infra_state AS s FROM tasks WHERE id = ?').get(taskId) as
      | { s: string | null }
      | undefined;
    return row?.s ? assertTaskState(row.s) : null;
  }

  /**
   * Tasks left RUNNING with no active worker lease.
   *
   * This is the residue of a crash between closing a lease and transitioning
   * the task. Without this query such a task is invisible to lease-based
   * reconciliation and would stay RUNNING forever.
   */
  listRunningTasksWithoutActiveLease(): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE t.state = 'RUNNING'
           AND NOT EXISTS (
             SELECT 1 FROM worker_leases wl
             WHERE wl.task_id = t.id AND wl.status = 'ACTIVE'
           )`,
      )
      .all() as TaskRow[];
    return rows.map((r) => this.mapTask(r));
  }

  /**
   * Active resource leases held by tasks that are neither running nor leased —
   * a scarce slot nobody is using.
   */
  listOrphanedResourceLeases(): ResourceLease[] {
    const rows = this.db
      .prepare(
        `SELECT rl.* FROM resource_leases rl
         JOIN tasks t ON t.id = rl.task_id
         WHERE rl.status = 'ACTIVE'
           AND t.state <> 'RUNNING'
           AND NOT EXISTS (
             SELECT 1 FROM worker_leases wl
             WHERE wl.task_id = rl.task_id AND wl.status = 'ACTIVE'
           )`,
      )
      .all() as Array<{
        id: string;
        resource_name: string;
        task_id: string;
        worker_id: string | null;
        acquired_at: string;
        expires_at: string | null;
        status: string;
      }>;
    return rows.map((r) => this.mapResourceLease(r));
  }

  updateTaskFields(
    taskId: string,
    fields: Partial<
      Pick<Task, 'prNumber' | 'prBaseSha' | 'prHeadSha' | 'ciStatus' | 'priority' | 'reviewMaxRounds'>
    >,
  ): void {
    const map: Record<string, string> = {
      prNumber: 'pr_number',
      prBaseSha: 'pr_base_sha',
      prHeadSha: 'pr_head_sha',
      ciStatus: 'ci_status',
      priority: 'priority',
      reviewMaxRounds: 'review_max_rounds',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(map)) {
      if (key in fields) {
        sets.push(`${column} = ?`);
        params.push((fields as Record<string, unknown>)[key] ?? null);
      }
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(this.now(), taskId);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // -------------------------------------------------------------- dependencies

  addDependencyRow(taskId: string, dependsOnTaskId: string, requiredState: TaskState): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO task_dependencies (task_id, depends_on_task_id, required_state) VALUES (?, ?, ?)',
      )
      .run(taskId, dependsOnTaskId, requiredState);
  }

  listDependencies(taskId: string): TaskDependency[] {
    const rows = this.db
      .prepare('SELECT * FROM task_dependencies WHERE task_id = ?')
      .all(taskId) as Array<{ task_id: string; depends_on_task_id: string; required_state: string }>;
    return rows.map((r) => ({
      taskId: r.task_id,
      dependsOnTaskId: r.depends_on_task_id,
      requiredState: r.required_state as TaskState,
    }));
  }

  listAllDependencies(): TaskDependency[] {
    const rows = this.db.prepare('SELECT * FROM task_dependencies').all() as Array<{
      task_id: string;
      depends_on_task_id: string;
      required_state: string;
    }>;
    return rows.map((r) => ({
      taskId: r.task_id,
      dependsOnTaskId: r.depends_on_task_id,
      requiredState: r.required_state as TaskState,
    }));
  }

  // ----------------------------------------------------------------- workers

  registerWorker(input: { provider: string; capabilities: string[]; id?: string }): Worker {
    const ts = this.now();
    const worker: Worker = {
      id: input.id ?? this.newId('wk'),
      provider: input.provider,
      capabilities: input.capabilities,
      status: 'IDLE',
      createdAt: ts,
      lastSeenAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO workers (id, provider, capabilities, status, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        worker.id,
        worker.provider,
        JSON.stringify(worker.capabilities),
        worker.status,
        worker.createdAt,
        worker.lastSeenAt,
      );
    return worker;
  }

  getWorker(id: string): Worker | null {
    const row = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(id) as
      | {
          id: string;
          provider: string;
          capabilities: string;
          status: string;
          created_at: string;
          last_seen_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      capabilities: parseStringArray(row.capabilities),
      status: row.status as WorkerStatus,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }

  listWorkers(status?: WorkerStatus): Worker[] {
    const rows = (
      status
        ? this.db.prepare('SELECT id FROM workers WHERE status = ? ORDER BY created_at').all(status)
        : this.db.prepare('SELECT id FROM workers ORDER BY created_at').all()
    ) as Array<{ id: string }>;
    return rows.map((r) => this.getWorker(r.id)).filter((w): w is Worker => w !== null);
  }

  setWorkerStatus(workerId: string, status: WorkerStatus): void {
    this.db
      .prepare('UPDATE workers SET status = ?, last_seen_at = ? WHERE id = ?')
      .run(status, this.now(), workerId);
  }

  removeWorker(workerId: string): void {
    this.db.prepare('DELETE FROM workers WHERE id = ?').run(workerId);
  }

  // ----------------------------------------------------------- worker leases

  createWorkerLease(input: { taskId: string; workerId: string; ttlMs: number }): WorkerLease {
    const startedAt = this.clock.now();
    const lease: WorkerLease = {
      id: this.newId('wlease'),
      taskId: input.taskId,
      workerId: input.workerId,
      startedAt: startedAt.toISOString(),
      heartbeatAt: startedAt.toISOString(),
      expiresAt: new Date(startedAt.getTime() + input.ttlMs).toISOString(),
      status: 'ACTIVE',
    };
    this.db
      .prepare(
        `INSERT INTO worker_leases (id, task_id, worker_id, started_at, heartbeat_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lease.id,
        lease.taskId,
        lease.workerId,
        lease.startedAt,
        lease.heartbeatAt,
        lease.expiresAt,
        lease.status,
      );
    return lease;
  }

  private mapWorkerLease(row: {
    id: string;
    task_id: string;
    worker_id: string;
    started_at: string;
    heartbeat_at: string;
    expires_at: string;
    status: string;
  }): WorkerLease {
    return {
      id: row.id,
      taskId: row.task_id,
      workerId: row.worker_id,
      startedAt: row.started_at,
      heartbeatAt: row.heartbeat_at,
      expiresAt: row.expires_at,
      status: row.status as WorkerLease['status'],
    };
  }

  getActiveWorkerLeaseForTask(taskId: string): WorkerLease | null {
    const row = this.db
      .prepare("SELECT * FROM worker_leases WHERE task_id = ? AND status = 'ACTIVE'")
      .get(taskId) as Parameters<Store['mapWorkerLease']>[0] | undefined;
    return row ? this.mapWorkerLease(row) : null;
  }

  listActiveWorkerLeases(): WorkerLease[] {
    const rows = this.db
      .prepare("SELECT * FROM worker_leases WHERE status = 'ACTIVE'")
      .all() as Array<Parameters<Store['mapWorkerLease']>[0]>;
    return rows.map((r) => this.mapWorkerLease(r));
  }

  heartbeatWorkerLease(leaseId: string, ttlMs: number): void {
    const now = this.clock.now();
    this.db
      .prepare('UPDATE worker_leases SET heartbeat_at = ?, expires_at = ? WHERE id = ?')
      .run(now.toISOString(), new Date(now.getTime() + ttlMs).toISOString(), leaseId);
  }

  closeWorkerLease(leaseId: string, status: 'RELEASED' | 'STALE'): void {
    this.db.prepare('UPDATE worker_leases SET status = ? WHERE id = ?').run(status, leaseId);
  }

  // --------------------------------------------------------------- resources

  upsertResource(def: ResourceDefinition): void {
    this.db
      .prepare(
        `INSERT INTO resources (name, capacity, founder_required, founder_category) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET capacity = excluded.capacity,
                                         founder_required = excluded.founder_required,
                                         founder_category = excluded.founder_category`,
      )
      .run(def.name, def.capacity, def.founderAuthorizationRequired ? 1 : 0, def.founderCategory ?? null);
  }

  getResource(name: string): ResourceDefinition | null {
    const row = this.db.prepare('SELECT * FROM resources WHERE name = ?').get(name) as
      | { name: string; capacity: number; founder_required: number; founder_category: string | null }
      | undefined;
    return row
      ? {
          name: row.name,
          capacity: row.capacity,
          founderAuthorizationRequired: row.founder_required === 1,
          founderCategory: (row.founder_category as ResourceDefinition['founderCategory']) ?? null,
        }
      : null;
  }

  listResources(): ResourceDefinition[] {
    const rows = this.db.prepare('SELECT * FROM resources ORDER BY name').all() as Array<{
      name: string;
      capacity: number;
      founder_required: number;
      founder_category: string | null;
    }>;
    return rows.map((r) => ({
      name: r.name,
      capacity: r.capacity,
      founderAuthorizationRequired: r.founder_required === 1,
      founderCategory: (r.founder_category as ResourceDefinition['founderCategory']) ?? null,
    }));
  }

  countActiveResourceLeases(resourceName: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM resource_leases WHERE resource_name = ? AND status = 'ACTIVE'")
      .get(resourceName) as { n: number };
    return row.n;
  }

  createResourceLease(input: {
    resourceName: string;
    taskId: string;
    workerId?: string | null;
    ttlMs?: number | null;
  }): ResourceLease {
    const now = this.clock.now();
    const lease: ResourceLease = {
      id: this.newId('rlease'),
      resourceName: input.resourceName,
      taskId: input.taskId,
      workerId: input.workerId ?? null,
      acquiredAt: now.toISOString(),
      expiresAt: input.ttlMs ? new Date(now.getTime() + input.ttlMs).toISOString() : null,
      status: 'ACTIVE',
    };
    this.db
      .prepare(
        `INSERT INTO resource_leases (id, resource_name, task_id, worker_id, acquired_at, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lease.id,
        lease.resourceName,
        lease.taskId,
        lease.workerId,
        lease.acquiredAt,
        lease.expiresAt,
        lease.status,
      );
    return lease;
  }

  private mapResourceLease(row: {
    id: string;
    resource_name: string;
    task_id: string;
    worker_id: string | null;
    acquired_at: string;
    expires_at: string | null;
    status: string;
  }): ResourceLease {
    return {
      id: row.id,
      resourceName: row.resource_name,
      taskId: row.task_id,
      workerId: row.worker_id,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      status: row.status as ResourceLease['status'],
    };
  }

  listActiveResourceLeases(resourceName?: string): ResourceLease[] {
    const rows = (
      resourceName
        ? this.db
            .prepare("SELECT * FROM resource_leases WHERE status = 'ACTIVE' AND resource_name = ?")
            .all(resourceName)
        : this.db.prepare("SELECT * FROM resource_leases WHERE status = 'ACTIVE'").all()
    ) as Array<Parameters<Store['mapResourceLease']>[0]>;
    return rows.map((r) => this.mapResourceLease(r));
  }

  listResourceLeasesForTask(taskId: string): ResourceLease[] {
    const rows = this.db
      .prepare("SELECT * FROM resource_leases WHERE task_id = ? AND status = 'ACTIVE'")
      .all(taskId) as Array<Parameters<Store['mapResourceLease']>[0]>;
    return rows.map((r) => this.mapResourceLease(r));
  }

  closeResourceLease(leaseId: string, status: 'RELEASED' | 'STALE'): void {
    this.db.prepare('UPDATE resource_leases SET status = ? WHERE id = ?').run(status, leaseId);
  }

  // ---------------------------------------------------------------- reviews

  createReviewAttempt(input: {
    taskId: string;
    reviewer: string;
    round: number;
    baseSha: string;
    headSha: string;
    status: ReviewAttemptStatus;
    blocker?: number;
    high?: number;
    medium?: number;
    low?: number;
  }): ReviewAttempt {
    const attempt: ReviewAttempt = {
      id: this.newId('rev'),
      taskId: input.taskId,
      reviewer: input.reviewer,
      round: input.round,
      baseSha: input.baseSha,
      headSha: input.headSha,
      blocker: input.blocker ?? 0,
      high: input.high ?? 0,
      medium: input.medium ?? 0,
      low: input.low ?? 0,
      status: input.status,
      createdAt: this.now(),
      completedAt: input.status === 'RUNNING' ? null : this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO review_attempts (id, task_id, reviewer, round, base_sha, head_sha, blocker, high, medium, low, status, created_at, completed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        attempt.id,
        attempt.taskId,
        attempt.reviewer,
        attempt.round,
        attempt.baseSha,
        attempt.headSha,
        attempt.blocker,
        attempt.high,
        attempt.medium,
        attempt.low,
        attempt.status,
        attempt.createdAt,
        attempt.completedAt,
      );
    return attempt;
  }

  private mapReviewAttempt(row: {
    id: string;
    task_id: string;
    reviewer: string;
    round: number;
    base_sha: string;
    head_sha: string;
    blocker: number;
    high: number;
    medium: number;
    low: number;
    status: string;
    created_at: string;
    completed_at: string | null;
  }): ReviewAttempt {
    return {
      id: row.id,
      taskId: row.task_id,
      reviewer: row.reviewer,
      round: row.round,
      baseSha: row.base_sha,
      headSha: row.head_sha,
      blocker: row.blocker,
      high: row.high,
      medium: row.medium,
      low: row.low,
      status: row.status as ReviewAttemptStatus,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  listReviewAttempts(taskId: string): ReviewAttempt[] {
    const rows = this.db
      .prepare('SELECT * FROM review_attempts WHERE task_id = ? ORDER BY created_at')
      .all(taskId) as Array<Parameters<Store['mapReviewAttempt']>[0]>;
    return rows.map((r) => this.mapReviewAttempt(r));
  }

  // -------------------------------------------------------- founder decisions

  createFounderDecision(input: {
    taskId: string | null;
    category: FounderDecisionCategory;
    question: string;
    provenance: string;
  }): FounderDecision {
    const decision: FounderDecision = {
      id: this.newId('fd'),
      taskId: input.taskId,
      category: input.category,
      question: input.question,
      state: 'REQUIRED',
      resolution: null,
      resolvedTarget: null,
      provenance: input.provenance,
      createdAt: this.now(),
      resolvedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO founder_decisions (id, task_id, category, question, state, resolution, provenance, created_at, resolved_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        decision.id,
        decision.taskId,
        decision.category,
        decision.question,
        decision.state,
        decision.resolution,
        decision.provenance,
        decision.createdAt,
        decision.resolvedAt,
      );
    return decision;
  }

  private mapFounderDecision(row: {
    id: string;
    task_id: string | null;
    category: string;
    question: string;
    state: string;
    resolution: string | null;
    provenance: string;
    created_at: string;
    resolved_at: string | null;
    resolved_target: string | null;
  }): FounderDecision {
    return {
      id: row.id,
      taskId: row.task_id,
      category: row.category as FounderDecisionCategory,
      question: row.question,
      state: row.state as FounderDecisionState,
      resolution: row.resolution,
      resolvedTarget: row.resolved_target ? assertTaskState(row.resolved_target) : null,
      provenance: row.provenance,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  getFounderDecision(id: string): FounderDecision | null {
    const row = this.db.prepare('SELECT * FROM founder_decisions WHERE id = ?').get(id) as
      | Parameters<Store['mapFounderDecision']>[0]
      | undefined;
    return row ? this.mapFounderDecision(row) : null;
  }

  listFounderDecisions(filter: { taskId?: string; state?: FounderDecisionState } = {}): FounderDecision[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.taskId) {
      clauses.push('task_id = ?');
      params.push(filter.taskId);
    }
    if (filter.state) {
      clauses.push('state = ?');
      params.push(filter.state);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM founder_decisions ${where} ORDER BY created_at`)
      .all(...params) as Array<Parameters<Store['mapFounderDecision']>[0]>;
    return rows.map((r) => this.mapFounderDecision(r));
  }

  setFounderDecisionState(
    id: string,
    state: FounderDecisionState,
    resolution: string | null,
    resolvedTarget: TaskState | null = null,
  ): void {
    this.db
      .prepare(
        'UPDATE founder_decisions SET state = ?, resolution = ?, resolved_target = ?, resolved_at = ? WHERE id = ?',
      )
      .run(
        state,
        resolution,
        resolvedTarget === null ? null : assertTaskState(resolvedTarget),
        state === 'REQUIRED' ? null : this.now(),
        id,
      );
  }

  // ----------------------------------------------------------------- history

  appendEvent(input: {
    taskId: string | null;
    eventType: string;
    actor: string;
    fromState?: TaskState | null;
    toState?: TaskState | null;
    payload?: unknown;
  }): HistoryEvent {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM events').get() as { m: number };
    const seq = row.m + 1;
    const event: HistoryEvent = {
      id: this.newId('ev'),
      taskId: input.taskId,
      eventType: input.eventType,
      actor: input.actor,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      payload: input.payload ?? {},
      createdAt: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO events (id, task_id, event_type, actor, from_state, to_state, payload, created_at, seq)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        event.id,
        event.taskId,
        event.eventType,
        event.actor,
        event.fromState,
        event.toState,
        JSON.stringify(event.payload),
        event.createdAt,
        seq,
      );
    return event;
  }

  listEvents(taskId?: string, limit = 200): HistoryEvent[] {
    const rows = (
      taskId
        ? this.db
            .prepare('SELECT * FROM events WHERE task_id = ? ORDER BY seq DESC LIMIT ?')
            .all(taskId, limit)
        : this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(limit)
    ) as Array<{
      id: string;
      task_id: string | null;
      event_type: string;
      actor: string;
      from_state: string | null;
      to_state: string | null;
      payload: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      eventType: r.event_type,
      actor: r.actor,
      fromState: r.from_state as TaskState | null,
      toState: r.to_state as TaskState | null,
      payload: JSON.parse(r.payload) as unknown,
      createdAt: r.created_at,
    }));
  }

  // ---------------------------------------------------------- worker reports

  recordWorkerReport(input: {
    taskId: string | null;
    workerId: string | null;
    accepted: boolean;
    reason: string | null;
    payload: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO worker_reports (id, task_id, worker_id, accepted, reason, payload, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        this.newId('rep'),
        input.taskId,
        input.workerId,
        input.accepted ? 1 : 0,
        input.reason,
        JSON.stringify(input.payload ?? null),
        this.now(),
      );
  }

  latestWorkerReport(taskId: string): unknown | null {
    const row = this.db
      .prepare('SELECT payload FROM worker_reports WHERE task_id = ? AND accepted = 1 ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as unknown) : null;
  }
}
