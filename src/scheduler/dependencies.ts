/**
 * Task dependency DAG.
 *
 * Dependencies are edges "task depends on other task reaching a required
 * state". Adding an edge that would close a cycle — directly or transitively —
 * is rejected before it is persisted, so the stored graph is always acyclic.
 *
 * Readiness is deterministic: a task is ready when every dependency has reached
 * its required state. Nothing else is consulted, so two runs over the same
 * database always agree.
 */

import type { Store } from '../state/store.js';
import type { TaskState } from '../domain/states.js';

export class DependencyCycleError extends Error {
  constructor(public readonly path: string[]) {
    super(`dependency cycle rejected: ${path.join(' -> ')}`);
    this.name = 'DependencyCycleError';
  }
}

export interface DependencyStatus {
  dependsOnTaskId: string;
  requiredState: TaskState;
  actualState: TaskState | 'MISSING';
  satisfied: boolean;
}

/** Adjacency map: task -> tasks it depends on. */
function buildAdjacency(store: Store): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const dep of store.listAllDependencies()) {
    const list = adjacency.get(dep.taskId);
    if (list) list.push(dep.dependsOnTaskId);
    else adjacency.set(dep.taskId, [dep.dependsOnTaskId]);
  }
  return adjacency;
}

/**
 * Depth-first search from `start` following "depends on" edges. Returns the
 * path to `target` if reachable, else null.
 */
function findPath(
  adjacency: Map<string, string[]>,
  start: string,
  target: string,
): string[] | null {
  const stack: Array<{ node: string; path: string[] }> = [{ node: start, path: [start] }];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    if (entry.node === target && entry.path.length > 1) return entry.path;
    if (seen.has(entry.node)) continue;
    seen.add(entry.node);
    for (const next of adjacency.get(entry.node) ?? []) {
      stack.push({ node: next, path: [...entry.path, next] });
    }
  }
  return null;
}

/**
 * Add `taskId depends on dependsOnTaskId`.
 *
 * Throws DependencyCycleError for a self-edge, a direct cycle, or a transitive
 * cycle. Nothing is written when the edge is rejected.
 */
export function addDependency(
  store: Store,
  taskId: string,
  dependsOnTaskId: string,
  requiredState: TaskState = 'DONE',
): void {
  if (taskId === dependsOnTaskId) {
    throw new DependencyCycleError([taskId, dependsOnTaskId]);
  }
  store.requireTask(taskId);
  store.requireTask(dependsOnTaskId);

  const adjacency = buildAdjacency(store);
  // Adding the edge creates a cycle exactly when the new dependency can already
  // reach `taskId` by following its own dependencies.
  const path = findPath(adjacency, dependsOnTaskId, taskId);
  if (path || dependsOnTaskId === taskId) {
    throw new DependencyCycleError([taskId, ...(path ?? [dependsOnTaskId])]);
  }
  store.addDependencyRow(taskId, dependsOnTaskId, requiredState);
}

export function dependencyStatuses(store: Store, taskId: string): DependencyStatus[] {
  return store.listDependencies(taskId).map((dep) => {
    const upstream = store.getTask(dep.dependsOnTaskId);
    const actualState: TaskState | 'MISSING' = upstream ? upstream.state : 'MISSING';
    return {
      dependsOnTaskId: dep.dependsOnTaskId,
      requiredState: dep.requiredState,
      actualState,
      satisfied: upstream !== null && upstream.state === dep.requiredState,
    };
  });
}

export function dependenciesSatisfied(store: Store, taskId: string): boolean {
  return dependencyStatuses(store, taskId).every((d) => d.satisfied);
}
