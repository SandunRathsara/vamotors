// Executable specification only. T03 adopts these semantics into shared runtime helpers.
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
