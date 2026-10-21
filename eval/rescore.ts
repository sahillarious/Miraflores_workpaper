// Re-verify saved eval reports with the current verifier, without calling the model.
// The recorded tool calls of each run are replayed to rebuild exactly what the
// model retrieved, then verifyReport runs on the saved report.
//   npx tsx eval/rescore.ts eval/results/run-....json
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildIndex } from '../src/domain/packetIndex';
import { buildCases } from '../src/domain/cases';
import type { Packet } from '../src/domain/types';
import { executeTool, ToolContext } from '../src/copilot/tools';
import { verifyReport } from '../src/copilot/verify';

const root = resolve(process.cwd());
const file = process.argv[2];
const ix = buildIndex(JSON.parse(readFileSync(join(root, 'public/data/okafor_lindqvist_2025_packet.json'), 'utf-8')) as Packet);
const defs = buildCases(ix);
const { results } = JSON.parse(readFileSync(file, 'utf-8'));
let before = 0, after = 0;
for (const r of results) {
  if (!r.report) { console.log(`${r.caseId} run ${r.run}: no report`); continue; }
  const ctx = new ToolContext(ix, defs);
  for (const t of r.trace) if (t.kind === 'tool' && t.name !== 'submit_report' && t.input !== undefined) { try { executeTool(ctx, t.name, t.input); } catch { /* the original call failed too */ } }
  const v = verifyReport(ctx, defs.find((d) => d.id === r.caseId)!, r.report);
  if (r.score.outcome === 'validated') before++;
  if (v.passed) after++;
  console.log(`${r.caseId} run ${r.run}: was ${r.score.outcome} (${r.score.validationIssues.length} issue(s)) → now ${v.passed ? 'validated' : 'unverified'}${v.issues.length ? ': ' + v.issues.map((i) => i.message).join(' | ') : ''}`);
}
console.log(`\nValidated: ${before}/${results.length} with the verifier used during the run → ${after}/${results.length} re-verified now.`);
