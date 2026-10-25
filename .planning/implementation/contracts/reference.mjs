// Executable specification only. T03 adopts these semantics into shared runtime helpers.
import { createHash } from 'node:crypto';
export const A = 99999999999999n;
export const C = 9999999999999999n;
export const B = 9223372036854775807n;
export function bounded(value, bound = B) {
  if (typeof value !== 'bigint' || value > bound || value < -bound) throw new RangeError('MONEY_OVERFLOW');
  return value;
}
export function minor(text, bound = A, signed = false) {
  if (typeof text !== 'string' || !/^(0|[1-9]\d*|-[1-9]\d*)$/.test(text)) throw new TypeError('INVALID_INPUT');
  const value = bounded(BigInt(text), bound);
  if (!signed && value < 0n) throw new RangeError('INVALID_INPUT');
  return value;
}
export function parseMajor(text, signed = false) {
  if (typeof text !== 'string') throw new TypeError('INVALID_INPUT');
  const clean = text.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new TypeError('INVALID_INPUT');
  const negative = clean.startsWith('-');
  const [whole, fraction = ''] = clean.replace(/^-/, '').split('.');
  const absolute = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const value = bounded(negative ? -absolute : absolute, A);
  if (!signed && value < 0n) throw new RangeError('INVALID_INPUT');
  return value.toString();
}
export function major(value) {
  bounded(value);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
export function sum(values, bound = B) {
  // SQL-equivalent arbitrary-width intermediate; every operand and final result bounded.
  const total = values.reduce((total, value) => total + bounded(value, bound), 0n);
  return bounded(total, bound);
}
export function cashTotals(facts) {
  const incoming = sum(facts.filter(f => f.direction === 'IN').map(f => minor(f.amount)));
  const outgoing = sum(facts.filter(f => f.direction === 'OUT').map(f => minor(f.amount)));
  return { incoming: incoming.toString(), outgoing: outgoing.toString(), net: bounded(incoming - outgoing).toString() };
}
export function roundRatio(numerator, denominator) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) throw new RangeError('INVALID_INPUT');
  const abs = numerator < 0n ? -numerator : numerator;
  const rounded = (2n * abs + denominator) / (2n * denominator);
  return numerator < 0n ? -rounded : rounded;
}
export function commission(basis, bps) {
  bounded(basis, C);
  if (basis < 0n || !Number.isInteger(bps) || bps < 0 || bps > 10000) throw new RangeError('INVALID_INPUT');
  return bounded(roundRatio(basis * BigInt(bps), 10000n), C);
}
export function tierDays(advance, listed) {
  bounded(advance, A); bounded(listed, A);
  if (advance <= 0n || listed <= 0n) throw new RangeError('INVALID_INPUT');
  return advance * 100n <= listed * 5n ? 7 : advance * 100n <= listed * 10n ? 14 : advance * 100n <= listed * 15n ? 21 : 31;
}
export function dateEpoch(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('INVALID_INPUT');
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new RangeError('INVALID_INPUT');
  return ms;
}
export function addDays(date, days) {
  if (!Number.isInteger(days)) throw new RangeError('INVALID_INPUT');
  return new Date(dateEpoch(date) + days * 86400000).toISOString().slice(0, 10);
}
export function reservationDates(date, days) {
  const validThrough = addDays(date, days);
  // Default policy fixture: modern Asia/Colombo UTC+05:30. Runtime must support snapshot IANA zone.
  return { validThrough, expiresAt: new Date(dateEpoch(addDays(validThrough, 1)) - 19800000).toISOString() };
}
export function overdue({ pending, outstanding, sent, cutoff, watermark = null }) {
  dateEpoch(sent); dateEpoch(cutoff); if (watermark !== null) dateEpoch(watermark);
  return pending && outstanding > 0n && sent <= cutoff && (sent <= addDays(cutoff, -2) || (watermark !== null && sent < watermark));
}
export const states = ['PURCHASED', 'IN_STOCK', 'IN_REPAIR', 'ADVANCE_PLACED', 'ADVANCE_EXPIRED',
  'FINANCE_PENDING', 'DO_RECEIVED', 'DELIVERED', 'SOLD', 'WRITTEN_OFF'];
const edges = {
  PURCHASED: { receiveStock: 'IN_STOCK', approvedWriteOff: 'WRITTEN_OFF' },
  IN_STOCK: { holdStock: 'IN_STOCK', releaseStock: 'IN_STOCK', sendRepair: 'IN_REPAIR',
    placeReservation: 'ADVANCE_PLACED', startFinance: 'FINANCE_PENDING',
    completeImmediate: 'SOLD', approvedWriteOff: 'WRITTEN_OFF' },
  IN_REPAIR: { returnRepair: 'IN_STOCK' },
  ADVANCE_PLACED: { expireReservation: 'ADVANCE_EXPIRED', convertReservation: 'SOLD', cancelRetained: 'IN_STOCK', approvedRefundCancel: 'IN_STOCK' },
  ADVANCE_EXPIRED: { convertReservation: 'SOLD', cancelRetained: 'IN_STOCK', approvedRefundCancel: 'IN_STOCK' },
  FINANCE_PENDING: { recordDO: 'DO_RECEIVED', approvedFinanceCorrection: 'IN_STOCK' },
  DO_RECEIVED: { confirmDOAndHandover: 'SOLD', approvedFinanceCorrection: 'IN_STOCK' },
  DELIVERED: { normalizeDelivered: 'SOLD' }, SOLD: {}, WRITTEN_OFF: {},
};
export function transition(state, action, evidence = {}) {
  const next = edges[state]?.[action];
  if (!next) throw new RangeError('INVALID_STATE');
  if (['completeImmediate', 'placeReservation', 'startFinance'].includes(action) && !evidence.available) throw new RangeError('STOCK_UNAVAILABLE');
  if (action === 'expireReservation' && (!evidence.due || !evidence.openCommitment)) throw new RangeError('INVALID_STATE');
  if (action === 'recordDO' && !evidence.verifiedDO) throw new RangeError('DOCUMENT_NOT_READY');
  if (action === 'confirmDOAndHandover' && (!evidence.verifiedDO || !evidence.completion || !evidence.handover)) throw new RangeError('INVALID_STATE');
  if (['completeImmediate', 'convertReservation'].includes(action) && (!evidence.completion || !evidence.handover)) throw new RangeError('INVALID_STATE');
  if (action.startsWith('approved') && (!evidence.approval || evidence.openObligation)) throw new RangeError('OBLIGATION_OPEN');
  if (action === 'normalizeDelivered' && (!evidence.completion || !evidence.handover)) throw new RangeError('DELIVERED_WITHOUT_COMPLETION');
  return next;
}
export function effectiveAvailable({ state, openCycle, staffAvailable, openCommitment, openRepair }) {
  return state === 'IN_STOCK' && openCycle && staffAvailable && !openCommitment && !openRepair;
}
export function facility({ gross, withheldDeductions, withheldFee }) {
  for (const amount of [gross, ...withheldDeductions, withheldFee]) {
    bounded(amount, A); if (amount < 0n) throw new RangeError('INVALID_INPUT');
  }
  const net = gross - sum(withheldDeductions, C) - withheldFee;
  if (net < 0n) throw new RangeError('BALANCE_MISMATCH');
  return bounded(net, C);
}

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateExpected(selectors, input, expected, context) {
  // context is already-authorized server rows/FK expansions, never a client owner assertion.
  const required = new Map();
  for (const selector of selectors) {
    let rows;
    if (selector.startsWith('@')) rows = context.expand(selector, input);
    else {
      const [type, path] = selector.split(':');
      const id = path.split('.').slice(1).reduce((v, key) => v?.[key], input);
      if (!id) throw new Error('INVALID_INPUT');
      rows = [context.load(type, id)];
    }
    if (!Array.isArray(rows)) throw new Error('REVISION_REQUIRED');
    for (const row of rows) {
      if (!row || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483647) throw new Error('NOT_FOUND');
      required.set(`${row.type}:${row.id}`, row);
    }
  }
  const supplied = new Map();
  for (const row of expected) {
    if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483647) throw new Error('INVALID_INPUT');
    const key = `${row.type}:${row.id}`;
    if (supplied.has(key) && supplied.get(key) !== row.revision) throw new Error('INVALID_INPUT');
    supplied.set(key, row.revision);
  }
  for (const [key, row] of required) {
    if (!supplied.has(key)) throw new Error('REVISION_REQUIRED');
    if (supplied.get(key) !== row.revision) throw new Error('STALE_REVISION');
  }
  return [...required.values()];
}

export function safeActorSnapshot(user, roles) {
  if (!user.active) throw new Error('ACCOUNT_INACTIVE');
  const currentRoles = roles.filter(r => r.active).slice().sort((a, b) => a.id.localeCompare(b.id));
  return { user: { id: user.id, name: user.name, active: true },
    authzRevision: digest([user.id, user.revision, user.active, currentRoles.map(r => [r.id, r.revision, r.grants])]),
    roles: currentRoles.map(r => ({ id: r.id, name: r.name, revision: r.revision })),
    presentationGrants: currentRoles.flatMap(r => structuredClone(r.grants)) };
}

export function loanMaximum(sheets, vehicle, asOf) {
  dateEpoch(asOf);
  const matching = sheets.filter(s => s.make === vehicle.make && s.model === vehicle.model && s.year === vehicle.year);
  const valid = matching.filter(s => s.validFrom <= asOf && s.validThrough >= asOf);
  if (valid.length > 1) throw new Error('INVALID_INPUT');
  if (!valid.length) return { status: 'UNAVAILABLE', reason: matching.length ? 'EXPIRED' : 'NO_SHEET', maximum: null, sheetId: null };
  return { status: 'APPLICABLE', sheetId: valid[0].id, maximum: valid[0].maximum,
    validFrom: valid[0].validFrom, validThrough: valid[0].validThrough };
}
export function compareExact(sheet, principal, months) {
  const maximum = sheet.maximum;
  if (minor(principal) > minor(maximum)) return { status: 'UNSUPPORTED', reason: 'OVER_LIMIT', maximum, sheetId: sheet.id };
  const card = sheet.cards.find(c => c.principal === principal && c.months === months);
  return card ? { status: 'SUPPORTED', maximum, sheetId: sheet.id, ...card } :
    { status: 'UNSUPPORTED', reason: 'NO_CARD', maximum, sheetId: sheet.id };
}
export function replaceQuote(deal, candidate, { expectedRevision, now, authorized }) {
  if (!authorized) throw new Error('FORBIDDEN');
  if (deal.revision !== expectedRevision) throw new Error('STALE_REVISION');
  if (['DISPATCHED', 'REFERRED', 'COMPLETED', 'REJECTED'].includes(deal.state) || deal.entitlementId) throw new Error('INVALID_STATE');
  if (candidate.companyId !== deal.companyId) throw new Error('BALANCE_MISMATCH');
  if (candidate.policy.path !== deal.path) throw new Error('PATH_MISMATCH');
  if (Date.parse(candidate.expiresAt) <= Date.parse(now)) throw new Error('QUOTE_EXPIRED');
  if (!candidate.supported) throw new Error('UNSUPPORTED_RATE');
  if (candidate.principal !== deal.approvedLoan || minor(candidate.principal) > minor(candidate.maximum)) throw new Error('BALANCE_MISMATCH');
  if (JSON.stringify(candidate.charges) !== JSON.stringify(deal.charges)) throw new Error('BALANCE_MISMATCH');
  if (deal.facility && deal.facility.gross !== candidate.principal) throw new Error('OBLIGATION_OPEN');
  const selection = { ...structuredClone(candidate), effectivePolicy: structuredClone(deal.policy) };
  return { ...structuredClone(deal), revision: deal.revision + 1, quote: selection,
    originalQuoteId: deal.originalQuoteId, policy: structuredClone(deal.policy),
    quoteHistory: [...structuredClone(deal.quoteHistory), selection],
    quoteStatus: 'SUPPORTED', verification: null, fileManifest: null,
    state: deal.path === 'APPLICATION' ? 'INSPECTED' : 'ELIGIBLE' };
}

// Core whole-graph invariants, NOT a replacement for T16 full DTO/auth/DB validation.
export function planHistoricalGraph(rows, namespace = 'synthetic') {
  if (!rows.length || rows.length > 200) throw new Error('IMPORT_INVALID: graph bound');
  const types = ['SUPPLIERS', 'CUSTOMERS', 'REPAIR_VENDORS', 'VEHICLES', 'SALES', 'REPAIRS', 'ADVANCES'];
  const key = r => `${namespace}:${r.type}:${r.sourceKey}`;
  const nodes = new Map();
  for (const row of rows) {
    if (!types.includes(row.type) || !row.sourceKey || nodes.has(key(row))) throw new Error('IMPORT_DUPLICATE');
    nodes.set(key(row), row);
  }
  function get(ref, type) {
    // This fixture planner exercises intra-graph links; runtime additionally checks locked existingDependencies.
    if (!ref || ref.namespace !== namespace || ref.type !== type) throw new Error('IMPORT_INVALID: reference type');
    const row = nodes.get(`${ref.namespace}:${ref.type}:${ref.sourceKey}`);
    if (!row) throw new Error('IMPORT_INVALID: unresolved edge');
    return row;
  }
  const cases = new Map(), provenance = [], paymentKeys = new Set();
  let purchase = 0n, cost = 0n, consideration = 0n, cashIn = 0n, cashOut = 0n;
  function payments(owner, facts) {
    for (const p of facts ?? []) {
      const claim = `${owner}:${p.sourceKey}`;
      if (!p.sourceKey || paymentKeys.has(claim)) throw new Error('IMPORT_DUPLICATE: receipt');
      paymentKeys.add(claim);
      const amount = minor(p.amount);
      if (amount <= 0n || !['IN', 'OUT'].includes(p.direction)) throw new Error('IMPORT_INVALID: payment');
      if (p.direction === 'IN') cashIn += amount; else cashOut += amount;
    }
  }
  for (const row of rows) {
    const p = row.payload;
    if (row.type === 'VEHICLES') {
      purchase += minor(p.purchasePrice);
      for (const c of p.additionalCosts ?? []) { cost += minor(c.amount); payments(`${key(row)}:cost:${c.sourceKey}`, c.payments); }
      payments(key(row), p.payments);
      if (p.supplier) get(p.supplier, 'SUPPLIERS');
      if (p.sellerCustomer) get(p.sellerCustomer, 'CUSTOMERS');
    }
    if (row.type === 'REPAIRS') {
      get(p.cycle, 'VEHICLES'); get(p.vendor, 'REPAIR_VENDORS');
      if (p.invoiceAmount !== undefined) cost += minor(p.invoiceAmount);
      payments(key(row), p.payments);
    }
    const targets = [key(row)];
    if (['ADVANCES', 'SALES'].includes(row.type)) {
      get(p.cycle, 'VEHICLES'); get(p.customer, 'CUSTOMERS');
      if (!p.saleCaseSourceKey) throw new Error('IMPORT_INVALID: shared case key');
      const caseKey = `${namespace}:SaleCase:${p.saleCaseSourceKey}`;
      const members = cases.get(caseKey) ?? [];
      if (members.some(m => m.type === row.type || get(m.payload.cycle, 'VEHICLES') !== get(p.cycle, 'VEHICLES'))) throw new Error('IMPORT_INVALID: shared case');
      members.push(row); cases.set(caseKey, members); targets.push(caseKey);
      payments(caseKey, p.payments);
    }
    provenance.push({ source: key(row), targets });
  }
  const completions = new Map();
  for (const row of rows.filter(r => r.type === 'SALES')) {
    const p = row.payload, cycle = get(p.cycle, 'VEHICLES');
    if (p.state === 'COMPLETED') {
      if (!p.completion || !['SOLD', 'DELIVERED'].includes(cycle.payload.status) || !cycle.payload.closedAt) throw new Error('IMPORT_INVALID: completion evidence');
      if (completions.has(key(cycle))) throw new Error('IMPORT_INVALID: duplicate completion');
      const repairs = rows.filter(r => r.type === 'REPAIRS' && key(get(r.payload.cycle, 'VEHICLES')) === key(cycle));
      const actualRepairs = repairs.filter(r => r.payload.invoiceAmount !== undefined).map(r => [r.sourceKey, r.payload.invoiceAmount]).sort();
      const actualCosts = (cycle.payload.additionalCosts ?? []).map(c => [c.sourceKey, c.amount]).sort();
      const suppliedRepairs = p.completion.basis.repairs.map(r => [r.sourceKey, r.amount]).sort();
      const suppliedCosts = p.completion.basis.costs.map(c => [c.sourceKey, c.amount]).sort();
      if (p.completion.basis.purchase !== cycle.payload.purchasePrice || JSON.stringify(actualRepairs) !== JSON.stringify(suppliedRepairs) || JSON.stringify(actualCosts) !== JSON.stringify(suppliedCosts)) throw new Error('IMPORT_INVALID: basis mismatch');
      consideration += minor(p.price);
      completions.set(key(cycle), key(row));
    }
    if (p.reservation) {
      const advance = get(p.reservation, 'ADVANCES');
      const a = advance.payload;
      if (a.state !== 'CONVERTED' || get(a.completedSale, 'SALES') !== row || a.saleCaseSourceKey !== p.saleCaseSourceKey ||
          get(a.cycle, 'VEHICLES') !== cycle || get(a.customer, 'CUSTOMERS') !== get(p.customer, 'CUSTOMERS') || a.agreed !== p.price) throw new Error('IMPORT_INVALID: reciprocal reservation');
      if (p.state !== 'COMPLETED') throw new Error('IMPORT_INVALID: converted without completion');
    }
  }
  for (const row of rows.filter(r => r.type === 'ADVANCES' && r.payload.state === 'CONVERTED')) {
    const sale = get(row.payload.completedSale, 'SALES');
    if (get(sale.payload.reservation, 'ADVANCES') !== row || sale.payload.state !== 'COMPLETED') throw new Error('IMPORT_INVALID: reciprocal completion');
  }
  for (const row of rows.filter(r => r.type === 'VEHICLES')) {
    if (['SOLD', 'DELIVERED'].includes(row.payload.status) && !completions.has(key(row))) throw new Error('IMPORT_INVALID: terminal without completion');
  }
  for (const members of cases.values()) {
    const sale = members.find(r => r.type === 'SALES' && r.payload.state === 'COMPLETED');
    if (sale && ['CASH', 'ADVANCE', 'TRADE_IN'].includes(sale.payload.kind)) {
      const net = sum(members.flatMap(r => r.payload.payments ?? []).map(p => minor(p.amount) * (p.direction === 'IN' ? 1n : -1n)));
      const noncash = sale.payload.kind === 'TRADE_IN' ? minor(sale.payload.tradeIn.value) : 0n;
      if (net + noncash !== minor(sale.payload.price)) throw new Error('IMPORT_INVALID: consideration mismatch');
    }
  }
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const normalizedRows = rows.map(r => ({ type: r.type, sourceKey: r.sourceKey, payload: r.payload })).sort((a, b) => key(a).localeCompare(key(b)));
  return { normalizedHash: digest(canonical(normalizedRows)), saleCases: [...cases].sort(([a], [b]) => a.localeCompare(b)).map(([sourceKey, members]) => ({ sourceKey, rowKeys: members.map(key).sort() })),
    provenance: provenance.sort((a, b) => a.source.localeCompare(b.source)), controlTotals: { rows: rows.length, purchase: bounded(purchase).toString(), cost: bounded(cost).toString(),
      consideration: bounded(consideration).toString(), cashIn: bounded(cashIn).toString(), cashOut: bounded(cashOut).toString(),
      byType: types.map(type => ({ type, rows: rows.filter(r => r.type === type).length })) } };
}

// In-memory frozen input models the E5 temporal prefix, NOT serverless materialization code.
export function exportSnapshot(rows, filter, authzRevision) {
  const ordered = structuredClone(rows).sort((a, b) => a.id.localeCompare(b.id));
  return { rows: ordered, filter: structuredClone(filter), authzRevision,
    digest: digest(ordered), total: sum(ordered.map(r => minor(r.amount))).toString() };
}
export function exportParts(snapshot, chunkSize, currentAuthzRevision) {
  if (currentAuthzRevision !== snapshot.authzRevision) throw new Error('FORBIDDEN');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 1000) throw new Error('INVALID_INPUT');
  const parts = [];
  for (let i = 0; i < snapshot.rows.length; i += chunkSize) {
    const rows = snapshot.rows.slice(i, i + chunkSize);
    parts.push({ ordinal: parts.length + 1, firstRow: i + 1, lastRow: i + rows.length,
      rowCount: rows.length, sha256: digest(rows), rows });
  }
  return parts;
}
export function completeExport(snapshot, parts) {
  let next = 1;
  for (const [index, part] of parts.entries()) {
    if (part.ordinal !== index + 1 || part.firstRow !== next || part.rowCount !== part.rows.length ||
        part.lastRow !== next + part.rowCount - 1 || part.sha256 !== digest(part.rows)) throw new Error('INVALID_INPUT: manifest coverage');
    next = part.lastRow + 1;
  }
  const rows = parts.flatMap(p => p.rows);
  if (rows.length !== snapshot.rows.length || digest(rows) !== snapshot.digest || sum(rows.map(r => minor(r.amount))).toString() !== snapshot.total) throw new Error('INVALID_INPUT: incomplete population');
  return { complete: true, rowCount: rows.length, total: snapshot.total, digest: snapshot.digest };
}
