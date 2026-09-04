/** Public surface of the orchestrator library. */

export { Orchestrator } from './orchestrator.js';
export type { OrchestratorOptions, SubmitReportResult, AppliedEvent } from './orchestrator.js';

export { Store, systemClock } from './state/store.js';
export type { Clock, StoreOptions } from './state/store.js';
export { StateEngine } from './state/engine.js';
export type { ApplyEventInput, ApplyResult } from './state/engine.js';
export { openDatabase, appliedMigrations } from './state/db.js';

export * from './domain/states.js';
export * from './domain/entities.js';
export * from './domain/report.js';
export * from './domain/coordinator.js';

export { loadPolicy, parsePolicy, policySchema, DEFAULT_POLICY } from './policy/schema.js';
export type { Policy } from './policy/schema.js';
export * from './policy/review.js';
export * from './policy/founderGate.js';

export { ResourceManager } from './resources/manager.js';
export { addDependency, dependenciesSatisfied, dependencyStatuses, DependencyCycleError } from './scheduler/dependencies.js';
export { tick } from './scheduler/tick.js';
export type { TickResult, DispatchIntent } from './scheduler/tick.js';
export { reconcileStaleLeases } from './scheduler/reconcile.js';

export { ProviderRegistry, workerMatches, CAPABILITIES } from './workers/provider.js';
export type { WorkerProvider, DispatchContext } from './workers/provider.js';
export { FakeWorkerProvider } from './workers/fake.js';

export { StubCoordinator } from './coordinator/stub.js';
export { parseCoordinatorOutput, validateCoordinatorAction } from './coordinator/validator.js';

export type { ProjectAdapter, ProjectDescriptor } from './projects/adapter.js';
export { FakeProjectAdapter } from './projects/fake.js';
export { SbaltReadOnlyProjectAdapter, sbaltProjectAdapterConfig } from './projects/sbalt.js';
