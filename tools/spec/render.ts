// Renders spec/01-invariants.md from invariants.json so the prose cannot drift from
// the manifest. The validator re-renders and compares; `npm run spec:render` writes it.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InvariantManifest } from './types.js';
import { loadBundle, repoRoot } from './load.js';

export function renderInvariants(m: InvariantManifest): string {
  const lines: string[] = [];
  lines.push('# 01 · The 47 invariants');
  lines.push('');
  lines.push(
    '<!-- GENERATED FROM spec/manifests/invariants.json BY tools/spec/render.ts — DO NOT EDIT BY HAND. -->',
  );
  lines.push('');
  lines.push(
    `**${m.census.invariants} invariants in ${m.census.families} families.** Each carries four owners: ` +
      'who states it (normative), who enforces it (enforcement), who stores what it constrains ' +
      '(persistence), and who tests it (test). A persistence owner of `n/a` carries an explicit note ' +
      'saying why nothing is stored.',
  );
  lines.push('');
  lines.push(
    'Statements marked **sharpened** were tightened by the Binding Founder Errata; the errata that ' +
      'reached each one are listed with it. See [12-errata.md](12-errata.md).',
  );
  lines.push('');

  const families = Object.keys(m.families);
  for (const family of families) {
    const members = m.invariants.filter((i) => i.family === family);
    lines.push(`## Family ${family} — ${m.families[family]} (${members.length})`);
    lines.push('');
    for (const inv of members) {
      lines.push(`### ${inv.id}`);
      lines.push('');
      lines.push(inv.statement);
      lines.push('');
      if (inv.sharpened) {
        lines.push(`*Sharpened by ${inv.errata.join(', ')}.*`);
        lines.push('');
      }
      const owners = inv.owners;
      lines.push('| Owner | Slice |');
      lines.push('|---|---|');
      lines.push(`| normative | ${owners.normative} |`);
      lines.push(`| enforcement | ${owners.enforcement.join(', ')} |`);
      lines.push(
        `| persistence | ${owners.persistence}${owners.persistence_note ? ` — ${owners.persistence_note}` : ''} |`,
      );
      lines.push(`| test | ${owners.test.join(', ')} |`);
      lines.push('');
      lines.push(
        `Introduced in ${inv.introducing_slice}; inherited by ${inv.inheriting_slices.join(', ') || '—'}.`,
      );
      lines.push('');
      for (const t of inv.tests) {
        lines.push(`- \`${t.name}\` (${t.kind}, ${t.slice}) — ${t.asserts}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function main(): void {
  const root = repoRoot();
  const bundle = loadBundle(root);
  const text = renderInvariants(bundle.invariants);
  writeFileSync(join(root, 'spec', '01-invariants.md'), text, 'utf8');
  console.log('wrote spec/01-invariants.md');
}

if (process.argv[1] && process.argv[1].endsWith('render.ts')) main();
