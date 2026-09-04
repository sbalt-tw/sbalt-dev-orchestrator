/**
 * Worker provider abstraction.
 *
 * A Worker is disposable compute. Lanes and Tasks are durable; workers may be
 * spawned, killed, restarted, swapped for a different provider or scaled from
 * one to ten without any workflow state being lost, because no workflow state
 * lives inside a worker.
 *
 * The scheduler never names a concrete worker. It asks for a worker with the
 * capabilities a task requires, which is why a future ClaudeCodeWorkerAdapter
 * slots in without touching the scheduler or the store.
 *
 * Phase 0 implements only the abstraction plus a fake provider for tests. There
 * is no live Claude, Codex or shell execution.
 */

import type { Task } from '../domain/entities.js';
import type { WorkerReport } from '../domain/report.js';

export const KNOWN_PROVIDERS = ['fake', 'claude-code', 'shell', 'github-action', 'codex', 'human'] as const;
export type ProviderName = (typeof KNOWN_PROVIDERS)[number] | (string & {});

/** Capability strings are free-form so projects can define their own. */
export const CAPABILITIES = {
  implementation: 'implementation',
  docs: 'docs',
  review: 'review',
  deployment: 'deployment',
} as const;

export interface DispatchContext {
  task: Pick<Task, 'id' | 'laneId' | 'title' | 'taskType' | 'riskClass' | 'requiredCapabilities'>;
  workerId: string;
  /** Read-only project references; never a mutation handle. */
  projectRefs: string[];
}

export interface WorkerProvider {
  readonly name: ProviderName;
  /** Capabilities every worker from this provider has. */
  capabilities(): string[];
  /**
   * Start work. Phase-0 providers return a report directly; a real provider
   * would return once the worker has been handed the task.
   */
  dispatch(context: DispatchContext): Promise<WorkerReport>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, WorkerProvider>();

  register(provider: WorkerProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): WorkerProvider | null {
    return this.providers.get(name) ?? null;
  }

  list(): WorkerProvider[] {
    return [...this.providers.values()];
  }
}

/** Does this worker satisfy everything the task asks for? */
export function workerMatches(
  workerCapabilities: readonly string[],
  requiredCapabilities: readonly string[],
): boolean {
  return requiredCapabilities.every((c) => workerCapabilities.includes(c));
}
