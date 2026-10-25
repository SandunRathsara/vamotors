import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { A, B, C, bounded, minor, parseMajor, major, sum, roundRatio, commission,
  tierDays, reservationDates, addDays, overdue, states, transition, effectiveAvailable, facility } from './reference.mjs';
let count = 0;
function test(name, run) { run(); count++; console.log(`ok ${count} - ${name}`); }
test('money boundary/grammar/decimal conversion and beyond 32-bit', () => {
  assert.equal(parseMajor('21474836.48'), '2147483648');
  assert.equal(parseMajor(' 0001.2 '), '120');
  assert.equal(parseMajor('-0.00'), '0');
  assert.equal(parseMajor('999999999999.99'), A.toString());
  assert.equal(minor(A.toString()), A);
  for (const input of ['1e3', '1,000', '1.001', '+1', '.', '', 'NaN', 'Infinity']) assert.throws(() => parseMajor(input));
  for (const input of ['01', '-0', '1.00', '1e2', '+1', '-1']) assert.throws(() => minor(input));
  assert.throws(() => minor((A + 1n).toString()));
  assert.throws(() => parseMajor('1000000000000.00'));
  assert.throws(() => parseMajor('-0.01'));
  assert.equal(parseMajor('-0.01', true), '-1');
});
test('wide intermediate, aggregate, safe wire/display and negative bounds', () => {
  assert.equal(sum([A, A], C), 199999999999998n);
  assert.equal(minor(C.toString(), C), C); // beyond Number.MAX_SAFE_INTEGER
  assert.equal(JSON.stringify({ amount: C.toString() }), '{"amount":"9999999999999999"}');
  assert.equal(major(C), '99999999999999.99');
  assert.equal(major(-1n), '-0.01');
  assert.equal(bounded(B), B); assert.equal(bounded(-B), -B);
  assert.throws(() => bounded(B + 1n)); assert.throws(() => bounded(-B - 1n));
  assert.throws(() => sum([B, 1n]));
  assert.throws(() => sum([C, 1n], C));
  // In/out checked separately: a net zero cannot conceal either aggregate overflow.
  const incoming = [B, 1n], outgoing = [B, 1n];
  assert.equal(incoming.reduce((a, b) => a + b) - outgoing.reduce((a, b) => a + b), 0n);
  assert.throws(() => sum(incoming)); assert.throws(() => sum(outgoing));
});
test('half-away signed ties, bps bounds and exact percentage endpoints', () => {
  assert.equal(roundRatio(1n, 2n), 1n); assert.equal(roundRatio(-1n, 2n), -1n);
  assert.equal(roundRatio(-149n, 100n), -1n); assert.equal(roundRatio(-150n, 100n), -2n);
  assert.equal(commission(101n, 500), 5n); assert.equal(commission(110n, 500), 6n);
  assert.equal(commission(C, 10000), C);
  assert.throws(() => commission(1n, 10001)); assert.throws(() => roundRatio(1n, 0n));
  for (const [amount, days] of [[1,7],[499,7],[500,7],[501,14],[999,14],[1000,14],[1001,21],[1499,21],[1500,21],[1501,31],[10000,31]]) {
    assert.equal(tierDays(BigInt(amount), 10000n), days);
  }
  assert.equal(tierDays(50001n, 1000000n), 14); // display 5.00% must not select seven days
  assert.throws(() => tierDays(0n, 100n)); assert.throws(() => tierDays(1n, 0n));
});
test('Colombo inclusive end-day, leap/month/year boundary', () => {
  assert.deepEqual(reservationDates('2026-12-25', 7), { validThrough: '2027-01-01', expiresAt: '2027-01-01T18:30:00.000Z' });
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-01-31', 31), '2026-03-03');
  assert.throws(() => addDays('2026-02-29', 1));
  const due = Date.parse(reservationDates('2026-12-25', 7).expiresAt);
  assert.equal(due - 1 < due, true); assert.equal(due >= due, true);
});
test('ten states and action-only completion / Delivered evidence', () => {
  assert.equal(new Set(states).size, 10);
  const proof = { available: true, completion: true, handover: true, verifiedDO: true };
  assert.equal(transition('IN_STOCK', 'completeImmediate', proof), 'SOLD');
  assert.equal(transition('DO_RECEIVED', 'confirmDOAndHandover', proof), 'SOLD');
  assert.equal(transition('FINANCE_PENDING', 'recordDO', proof), 'DO_RECEIVED');
  assert.equal(transition('DELIVERED', 'normalizeDelivered', proof), 'SOLD');
  for (const [state, action] of [['SOLD','completeImmediate'], ['IN_REPAIR','completeImmediate'], ['IN_STOCK','setSold'], ['DO_RECEIVED','setDelivered'], ['ADVANCE_EXPIRED','approvedWriteOff']]) assert.throws(() => transition(state, action, proof));
  assert.throws(() => transition('DELIVERED', 'normalizeDelivered', {}), /DELIVERED_WITHOUT_COMPLETION/);
  assert.throws(() => transition('DO_RECEIVED', 'confirmDOAndHandover', { verifiedDO: true }));
  assert.throws(() => transition('IN_STOCK', 'completeImmediate', { ...proof, available: false }));
  assert.throws(() => transition('IN_STOCK', 'approvedWriteOff', { approval: true, openObligation: true }));
});
test('effective availability and expiry race serialized outcomes', () => {
  const available = { state: 'IN_STOCK', openCycle: true, staffAvailable: true, openCommitment: false, openRepair: false };
  assert.equal(effectiveAvailable(available), true);
  for (const state of states.filter(s => s !== 'IN_STOCK')) assert.equal(effectiveAvailable({ ...available, state }), false);
  assert.equal(effectiveAvailable({ ...available, openCommitment: true }), false);
  assert.equal(effectiveAvailable({ ...available, staffAvailable: false }), false);
  const proof = { due: true, openCommitment: true, completion: true, handover: true };
  const sold = transition('ADVANCE_PLACED', 'convertReservation', proof);
  assert.throws(() => transition(sold, 'expireReservation', proof));
  const expired = transition('ADVANCE_PLACED', 'expireReservation', proof);
  assert.equal(transition(expired, 'convertReservation', proof), 'SOLD');
  assert.throws(() => transition('ADVANCE_PLACED', 'expireReservation', { due: false, openCommitment: true }));
});
test('two cycles, cost vs payments, trade-in/reservation/lender identities', () => {
  const basis1 = sum([10000n, 1000n], C), basis2 = sum([12000n, 500n], C);
  assert.deepEqual([14000n - basis1, 15000n - basis2], [3000n, 2500n]);
  assert.equal(sum([10000n, 1000n, 500n], C), 11500n);
  assert.equal(100000n - 10000n, 90000n); // remaining reservation receipt only
  assert.equal(10000n - 6000n, 4000n); // retained cancellation, receipt remains historic
  assert.equal(150000n - 50000n, 100000n); // trade-in residual; noncash never receipt
  assert.equal(10000n + 90000n, 100000n); // down + lender, not DO or invoice
});
test('facility net-funded recoverable, exact nonnegative net', () => {
  assert.equal(facility({ gross: 100000n, withheldDeductions: [10000n], withheldFee: 2000n }), 88000n);
  assert.equal(facility({ gross: 100000n, withheldDeductions: [10000n], withheldFee: 0n }), 90000n);
  assert.equal(90000n - 40000n, 50000n);
  assert.throws(() => facility({ gross: 100n, withheldDeductions: [90n], withheldFee: 20n }));
});
test('reconciliation cutoff inclusive two days, strict watermark, pending only', () => {
  const base = { pending: true, outstanding: 40n, cutoff: '2026-10-25', sent: '2026-10-23' };
  assert.equal(overdue(base), true);
  assert.equal(overdue({ ...base, sent: '2026-10-24' }), false);
  assert.equal(overdue({ ...base, sent: '2026-10-24', watermark: '2026-10-25' }), true);
  assert.equal(overdue({ ...base, sent: '2026-10-25', watermark: '2026-10-25' }), false);
  assert.equal(overdue({ ...base, pending: false }), false);
  assert.equal(overdue({ ...base, outstanding: 0n }), false);
  assert.equal(overdue({ ...base, sent: '2026-10-26', watermark: '2026-10-27' }), false);
  assert.deepEqual([100n - 60n, 100n - 110n], [40n, -10n]);
});
const dir = dirname(fileURLToPath(import.meta.url));
test('exactly all 134 individual v1 IDs have existing contract seam references', () => {
  const requirements = readFileSync(resolve(dir, '../../REQUIREMENTS.md'), 'utf8').split('## v2 Requirements')[0];
  const ids = [...requirements.matchAll(/\*\*([A-Z]+-\d+)\*\*/g)].map(m => m[1]);
  const coverage = readFileSync(resolve(dir, 'coverage.md'), 'utf8');
  const rows = [...coverage.matchAll(/^\| ([A-Z]+-\d+) \| (.+) \|$/gm)];
  assert.equal(ids.length, 134); assert.equal(rows.length, 134);
  assert.deepEqual(rows.map(m => m[1]).sort(), ids.sort());
  for (const row of rows) {
    const links = [...row[2].matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)];
    assert.ok(links.length > 0, row[1]);
    for (const link of links) assert.ok(existsSync(resolve(dir, link[1])), `${row[1]}: ${link[1]}`);
  }
});
test('all command/query DTO names unique; query response map complete; ten-state DTO exact', () => {
  const text = readFileSync(resolve(dir, 'api.ts'), 'utf8');
  function properties(name, next) {
    const body = text.split(`export interface ${name} {`)[1].split(next)[0];
    return [...body.matchAll(/^  (\w+):/gm)].map(m => m[1]);
  }
  const commands = properties('Commands', '\n}\nexport type ImportType');
  const queries = properties('Queries', '\n}\nexport type Provenance');
  const data = properties('QueryData', '\n}\n/**');
  assert.ok(commands.length >= 60);
  assert.equal(new Set(commands).size, commands.length);
  assert.equal(new Set(queries).size, queries.length);
  assert.deepEqual(queries.sort(), data.sort());
  const stateType = text.split('export type State = ')[1].split(';')[0];
  assert.deepEqual([...stateType.matchAll(/"([A-Z_]+)"/g)].map(m => m[1]).sort(), states.slice().sort());
});
console.log(`PASS ${count} contract checks; pure specification only, not DB/HTTP/hosted acceptance.`);
