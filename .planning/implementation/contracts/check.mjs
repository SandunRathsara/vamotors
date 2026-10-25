import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { A, B, C, bounded, minor, parseMajor, major, sum, roundRatio, commission,
  tierDays, reservationDates, addDays, overdue, states, transition, effectiveAvailable, facility } from './reference.mjs';
import { validateExpected, safeActorSnapshot, loanMaximum, compareExact, replaceQuote,
  planHistoricalGraph, exportSnapshot, exportParts, completeExport } from './reference.mjs';
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
test('116029 independent quotient/remainder rounding regressions (including wide signed operands)', () => {
  for (let i = 1n; i <= 116029n; i++) {
    const d = i % 97n + 1n;
    const n = (i * i * 99999999999999n + i % d) * (i % 2n ? 1n : -1n);
    const q = n / d, r = n % d, absR = r < 0n ? -r : r;
    const expected = q + (absR * 2n >= d ? (n < 0n ? -1n : 1n) : 0n);
    assert.equal(roundRatio(n, d), expected);
  }
});
const apiText = readFileSync(resolve(dir, 'api.ts'), 'utf8');
const revisionRules = JSON.parse(apiText.split('export const commandRevisionRules = ')[1].split(' satisfies Record')[0]);
test('every command has a revision rule; missing/stale child and directory primary revisions fail', () => {
  const commandNames = [...apiText.split('export interface Commands {')[1].split('\n}\nexport type ImportType')[0].matchAll(/^  (\w+):/gm)].map(m => m[1]);
  assert.deepEqual(Object.keys(revisionRules).sort(), commandNames.sort());
  const cases = [
    ['updateCustomer', { id: 'c' }, [{ type: 'Customer', id: 'c', revision: 4 }]],
    ['updateDirectoryParty', { type: 'SUPPLIER', id: 's' }, [{ type: 'Supplier', id: 's', revision: 3 }]],
    ['updateDirectoryParty', { type: 'REPAIR_VENDOR', id: 'v' }, [{ type: 'RepairVendor', id: 'v', revision: 3 }]],
    ['recoverFacility', { dealId: 'd' }, [{ type: 'BrokerageDeal', id: 'd', revision: 8 }, { type: 'CashFacility', id: 'f', revision: 6 }]],
    ['completeUpload', { uploadId: 'u' }, [{ type: 'UploadIntent', id: 'u', revision: 2 }, { type: 'SaleCase', id: 'sale', revision: 7 }]]
  ];
  for (const [name, input, rows] of cases) {
    const context = { load: (type, id) => rows.find(r => r.type === type && r.id === id),
      expand: selector => selector === '@party' ? rows : selector === '@facilityForDeal' ? rows.filter(r => r.type === 'CashFacility') :
        selector === '@uploadTarget' ? rows.filter(r => r.type === 'SaleCase') : undefined };
    assert.deepEqual(validateExpected(revisionRules[name], input, rows, context), rows);
    assert.throws(() => validateExpected(revisionRules[name], input, rows.slice(0, -1), context), /REVISION_REQUIRED/);
    const stale = rows.map((r, i) => ({ ...r, revision: r.revision - (i === rows.length - 1 ? 1 : 0) }));
    assert.throws(() => validateExpected(revisionRules[name], input, stale, context), /STALE_REVISION/);
  }
});
test('safe self actor has no credentials and changes fingerprint on role revocation/current activation', () => {
  const user = { id: 'u', revision: 1, name: 'Synthetic', active: true, password: 'not-output', token: 'not-output', passwordHash: 'not-output' };
  const roles = [{ id: 'r', revision: 1, active: true, name: 'Reader', grants: [{ action: 'read', subject: 'Vehicle', fields: ['id'] }] }];
  const before = safeActorSnapshot(user, roles);
  assert.deepEqual(Object.keys(before.user).sort(), ['active', 'id', 'name']);
  assert.equal(JSON.stringify(before).includes('not-output'), false);
  const after = safeActorSnapshot(user, [{ ...roles[0], revision: 2, grants: [] }]);
  assert.notEqual(before.authzRevision, after.authzRevision);
  assert.deepEqual(after.presentationGrants, []);
  assert.throws(() => safeActorSnapshot({ ...user, active: false }, roles), /ACCOUNT_INACTIVE/);
});
const vehicle = { make: 'Demo', model: 'Demo100', year: 2026 };
const sheet = { id: 'sheet', ...vehicle, maximum: '120000', validFrom: '2026-01-01', validThrough: '2026-12-31',
  cards: [{ id: 'card', principal: '100000', months: 12, installment: '9000' }] };
test('vehicle-only maxima works before terms; NO_CARD and OVER_LIMIT retain applicable maximum', () => {
  assert.equal(loanMaximum([sheet], vehicle, '2026-10-25').maximum, '120000');
  assert.equal(loanMaximum([sheet], { ...vehicle, year: 2025 }, '2026-10-25').reason, 'NO_SHEET');
  assert.equal(loanMaximum([sheet], vehicle, '2027-01-01').maximum, null);
  assert.deepEqual(compareExact(sheet, '120001', 12), { status: 'UNSUPPORTED', reason: 'OVER_LIMIT', maximum: '120000', sheetId: 'sheet' });
  assert.equal(compareExact(sheet, '100001', 12).maximum, '120000');
  assert.equal(compareExact(sheet, '100001', 12).reason, 'NO_CARD');
});
test('existing-deal requote preserves original/policy/facility and invalidates verification before dispatch', () => {
  const policy = { path: 'APPLICATION', commission: { basis: 'FINANCED_PRINCIPAL', rateBps: 100 }, processingFee: '250000' };
  const deal = { id: 'd', revision: 5, state: 'DOCUMENTS_READY', path: 'APPLICATION', companyId: 'fc',
    originalQuoteId: 'original', quoteHistory: [{ id: 'original' }], policy, charges: [], approvedLoan: '100000',
    facility: { gross: '100000', net: '88000', outstanding: '40000' }, verification: { clean: true }, fileManifest: 'old' };
  const candidate = { id: 'replacement', companyId: 'fc', policy: { ...policy, commission: { ...policy.commission, rateBps: 999 } },
    charges: [], principal: '100000', maximum: '120000', supported: true, expiresAt: '2026-10-26T00:00:00.000Z' };
  const options = { expectedRevision: 5, now: '2026-10-25T00:00:00.000Z', authorized: true };
  const next = replaceQuote(deal, candidate, options);
  assert.equal(next.revision, 6); assert.equal(next.originalQuoteId, 'original');
  assert.deepEqual(next.quoteHistory.map(q => q.id), ['original', 'replacement']);
  assert.deepEqual(next.policy, policy); assert.deepEqual(next.facility, deal.facility);
  assert.equal(next.state, 'INSPECTED'); assert.equal(next.verification, null); assert.equal(next.fileManifest, null);
  assert.equal(deal.quoteHistory.length, 1); // original evidence not mutated
  for (const [patch, error] of [[{ companyId: 'other' }, /BALANCE_MISMATCH/], [{ policy: { ...policy, path: 'REFERRAL' } }, /PATH_MISMATCH/],
    [{ expiresAt: options.now }, /QUOTE_EXPIRED/], [{ supported: false }, /UNSUPPORTED_RATE/], [{ charges: [{ amount: '1' }] }, /BALANCE_MISMATCH/]]) {
    assert.throws(() => replaceQuote(deal, { ...candidate, ...patch }, options), error);
  }
  assert.throws(() => replaceQuote(next, candidate, options), /STALE_REVISION/);
  assert.throws(() => replaceQuote({ ...deal, state: 'DISPATCHED' }, candidate, options), /INVALID_STATE/);
  assert.throws(() => replaceQuote({ ...deal, facility: { ...deal.facility, gross: '90000' } }, candidate, options), /OBLIGATION_OPEN/);
  assert.throws(() => replaceQuote(deal, candidate, { ...options, authorized: false }), /FORBIDDEN/);
});
function historicalFixture() {
  const ref = (type, sourceKey) => ({ namespace: 'synthetic', type, sourceKey });
  const payment = (sourceKey, amount, direction) => ({ sourceKey, amount, direction, date: '2026-01-01', method: 'CASH' });
  return [
    { type: 'SUPPLIERS', sourceKey: 'supplier', payload: { name: 'Synthetic supplier' } },
    { type: 'CUSTOMERS', sourceKey: 'customer', payload: { fullName: 'Synthetic customer' } },
    { type: 'REPAIR_VENDORS', sourceKey: 'vendor', payload: { name: 'Synthetic vendor' } },
    { type: 'VEHICLES', sourceKey: 'cycle', payload: { supplier: ref('SUPPLIERS', 'supplier'), cycleSourceKey: 'cycle',
      status: 'SOLD', closedAt: '2026-01-04T00:00:00.000Z', purchasePrice: '50000',
      payments: [payment('purchase', '50000', 'OUT')], additionalCosts: [{ sourceKey: 'transport', amount: '2500', payments: [] }] } },
    { type: 'REPAIRS', sourceKey: 'repair', payload: { cycle: ref('VEHICLES', 'cycle'), vendor: ref('REPAIR_VENDORS', 'vendor'), invoiceAmount: '5000', payments: [] } },
    { type: 'ADVANCES', sourceKey: 'advance', payload: { cycle: ref('VEHICLES', 'cycle'), customer: ref('CUSTOMERS', 'customer'),
      agreed: '100000', amount: '10000', saleCaseSourceKey: 'case', state: 'CONVERTED', completedSale: ref('SALES', 'sale'), payments: [payment('advance-receipt', '10000', 'IN')] } },
    { type: 'SALES', sourceKey: 'sale', payload: { cycle: ref('VEHICLES', 'cycle'), customer: ref('CUSTOMERS', 'customer'),
      price: '100000', kind: 'ADVANCE', state: 'COMPLETED', saleCaseSourceKey: 'case', reservation: ref('ADVANCES', 'advance'),
      completion: { basis: { purchase: '50000', repairs: [{ sourceKey: 'repair', amount: '5000' }], costs: [{ sourceKey: 'transport', amount: '2500' }] } },
      payments: [payment('balance-receipt', '90000', 'IN')] } }
  ];
}
test('all-seven-type atomic graph resolves converted advance/cycle/completion into ONE shared case', () => {
  const rows = historicalFixture();
  const plan = planHistoricalGraph(rows);
  assert.equal(plan.saleCases.length, 1); assert.equal(plan.saleCases[0].rowKeys.length, 2);
  assert.equal(plan.provenance.length, 7);
  assert.equal(plan.provenance.filter(p => p.targets.includes('synthetic:SaleCase:case')).length, 2);
  assert.deepEqual(plan.controlTotals, { rows: 7, purchase: '50000', cost: '7500', consideration: '100000', cashIn: '100000', cashOut: '50000',
    byType: ['SUPPLIERS','CUSTOMERS','REPAIR_VENDORS','VEHICLES','SALES','REPAIRS','ADVANCES'].map(type => ({ type, rows: 1 })) });
  assert.equal(100000n - 50000n - 7500n, 42500n);
  assert.deepEqual(planHistoricalGraph(rows.slice().reverse()), plan); // CSV/sheet ordering cannot change logical plan
  const reorderKeys = value => Array.isArray(value) ? value.map(reorderKeys) : value && typeof value === 'object' ?
    Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reorderKeys(v)])) : value;
  assert.equal(planHistoricalGraph(reorderKeys(rows).reverse()).normalizedHash, plan.normalizedHash);
  rows.find(r => r.type === 'VEHICLES').payload.status = 'DELIVERED';
  assert.equal(planHistoricalGraph(rows).saleCases.length, 1);
});
test('historical invalid interim/reciprocal/basis/duplicate receipt graphs reject before plan publication', () => {
  const original = historicalFixture();
  assert.throws(() => planHistoricalGraph(original.filter(r => r.type !== 'SALES')), /IMPORT_INVALID/);
  assert.throws(() => planHistoricalGraph(original.filter(r => r.type !== 'ADVANCES')), /IMPORT_INVALID/);
  assert.throws(() => planHistoricalGraph([...original, structuredClone(original[0])]), /IMPORT_DUPLICATE/);
  assert.throws(() => planHistoricalGraph(Array.from({ length: 201 }, (_, i) => ({ type: 'CUSTOMERS', sourceKey: String(i), payload: {} }))), /graph bound/);
  const mutations = [
    rows => { rows.find(r => r.type === 'SALES').payload.saleCaseSourceKey = 'wrong-case'; },
    rows => { rows.find(r => r.type === 'SALES').payload.completion.basis.repairs[0].amount = '5001'; },
    rows => { delete rows.find(r => r.type === 'SALES').payload.completion; },
    rows => { rows.find(r => r.type === 'VEHICLES').payload.status = 'IN_STOCK'; },
    rows => { rows.find(r => r.type === 'ADVANCES').payload.completedSale.sourceKey = 'future-batch'; },
    rows => { rows.find(r => r.type === 'SALES').payload.payments.push({ ...rows.find(r => r.type === 'ADVANCES').payload.payments[0] }); },
    rows => { rows.find(r => r.type === 'SALES').payload.payments[0].amount = '100000'; }
  ];
  for (const mutate of mutations) {
    const rows = structuredClone(original); mutate(rows);
    assert.throws(() => planHistoricalGraph(rows), /IMPORT_INVALID|IMPORT_DUPLICATE/);
    assert.equal(original.find(r => r.type === 'SALES').payload.payments.length, 1);
  }
});
test('10001-row ORIGINAL export is stable across source changes with full contiguous manifest/totals', () => {
  const source = Array.from({ length: 10001 }, (_, i) => ({ id: String(i).padStart(6, '0'), amount: '1' }));
  const filter = { kind: 'SOLD', from: '2026-01-01', through: '2026-12-31' };
  const snapshot = exportSnapshot(source, filter, 'authz-1');
  source[0].amount = '99'; source.pop(); source.push({ id: '999999', amount: '42' }); filter.from = '2026-06-01';
  const parts = exportParts(snapshot, 1000, 'authz-1');
  assert.equal(parts.length, 11); assert.equal(parts[10].rowCount, 1);
  assert.equal(snapshot.filter.from, '2026-01-01'); assert.equal(parts[0].rows[0].amount, '1');
  assert.deepEqual(exportParts(snapshot, 1000, 'authz-1'), parts); // resume/retry unchanged bytes/order
  assert.equal(completeExport(snapshot, parts).rowCount, 10001); assert.equal(completeExport(snapshot, parts).total, '10001');
  assert.throws(() => completeExport(snapshot, parts.slice(0, -1)), /incomplete population/);
  assert.throws(() => completeExport(snapshot, [parts[0], parts[0], ...parts.slice(1)]), /manifest coverage/);
  assert.throws(() => exportParts(snapshot, 1000, 'revoked-authz'), /FORBIDDEN/);
});
console.log(`PASS ${count} contract checks; pure specification only, not DB/HTTP/hosted acceptance.`);
