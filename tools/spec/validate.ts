// Specification validator. Non-runtime: it reads spec/ and reports drift.
//   npm run spec:validate

import { loadBundle, repoRoot } from './load.js';
import { runChecks, FAILURE_CODES } from './checks.js';
import { fixtures } from './fixtures.js';

function main(): void {
  const bundle = loadBundle(repoRoot());
  const problems = runChecks(bundle);

  console.log('SBALT Development Orchestrator — specification validator');
  console.log(`  invariants        ${bundle.invariants.invariants?.length ?? 0} in ${Object.keys(bundle.invariants.families ?? {}).length} families`);
  console.log(`  action matrix     ${Object.keys(bundle.actionMatrix.kinds ?? {}).length} kinds x ${bundle.actionMatrix.fields?.length ?? 0} fields`);
  console.log(`  task state        ${bundle.taskState.states?.length ?? 0} states, ${bundle.taskState.events?.length ?? 0} events, ${bundle.taskState.transitions?.length ?? 0} explicit cells`);
  console.log(`  slices            ${(bundle.slices.total_order ?? []).join(' -> ')}`);
  console.log(`  migrations        ${(bundle.slices.migration_chain ?? []).join(' -> ')}`);
  console.log(`  test triage       ${bundle.triage.rows?.length ?? 0} rows (${bundle.triage.census?.KEEP} keep, ${bundle.triage.census?.REWRITE} rewrite, ${bundle.triage.census?.DROP} drop)`);
  console.log(`  findings          ${bundle.findings.findings?.length ?? 0} from PR #1, ${bundle.findings.pr0_review?.findings?.length ?? 0} from PR-0 round 1, ${bundle.findings.carried_debt?.length ?? 0} debt items`);
  console.log(`  decisions         ${bundle.decisions.decisions?.length ?? 0}`);
  console.log(`  gates             ${(bundle.gates.gates ?? []).map((g) => g.id).join(', ')}`);
  console.log(`  validator         ${fixtures.length} mutation fixtures over ${FAILURE_CODES.length} failure codes, every fixture executed`);
  console.log('');

  if (problems.length === 0) {
    console.log('OK — every mechanical check passed, and every fixture turned its check red.');
    return;
  }

  console.error(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`  [${p.code}] ${p.detail}`);
  }
  process.exitCode = 1;
}

main();
