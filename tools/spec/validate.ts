// Specification validator. Non-runtime: it reads spec/ and reports drift.
//   npm run spec:validate

import { loadBundle, repoRoot } from './load.js';
import { runChecks } from './checks.js';

function main(): void {
  const bundle = loadBundle(repoRoot());
  const problems = runChecks(bundle);

  const inv = bundle.invariants;
  console.log('SBALT Development Orchestrator — specification validator');
  console.log(`  invariants        ${inv.invariants.length} in ${Object.keys(inv.families).length} families`);
  console.log(`  action matrix     ${Object.keys(bundle.actionMatrix.kinds).length} kinds x ${bundle.actionMatrix.fields.length} fields`);
  console.log(`  slices            ${bundle.slices.total_order.join(' -> ')}`);
  console.log(`  migrations        ${bundle.slices.migration_chain.join(' -> ')}`);
  console.log(`  test triage       ${bundle.triage.rows.length} rows (${bundle.triage.census.KEEP} keep, ${bundle.triage.census.REWRITE} rewrite, ${bundle.triage.census.DROP} drop)`);
  console.log(`  findings          ${bundle.findings.findings.length} itemised, ${bundle.findings.carried_debt.length} debt items`);
  console.log(`  decisions         ${bundle.decisions.decisions.length}`);
  console.log(`  gates             ${bundle.gates.gates.map((g) => g.id).join(', ')}`);
  console.log('');

  if (problems.length === 0) {
    console.log('OK — every mechanical check passed.');
    return;
  }

  console.error(`FAILED — ${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`  [${p.code}] ${p.detail}`);
  }
  process.exitCode = 1;
}

main();
