import type { State } from "../../.planning/implementation/contracts/api"
import { A, C, bounded, roundRatio, sum } from "../money"
import { states } from "../state"

export const VEHICLE_STATES = states

export const COLOMBO_TIMEZONE = "Asia/Colombo"

/**
 * Pure 10-state vehicle lifecycle transitions (S1/S2).
 * Normal completion always ends in SOLD; DELIVERED is retained solely for
 * legacy historical compatibility (normalizeDelivered -> SOLD) and is never
 * reachable as a transition target. Terminal states (SOLD, WRITTEN_OFF) have
 * no outgoing transitions within the same cycle.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<State, readonly State[]>> = {
  PURCHASED: ["IN_STOCK", "WRITTEN_OFF"],
  IN_STOCK: [
    "IN_STOCK",
    "IN_REPAIR",
    "ADVANCE_PLACED",
    "FINANCE_PENDING",
    "SOLD",
    "WRITTEN_OFF",
  ],
  IN_REPAIR: ["IN_STOCK"],
  ADVANCE_PLACED: ["ADVANCE_EXPIRED", "IN_STOCK", "SOLD"],
  ADVANCE_EXPIRED: ["IN_STOCK", "SOLD"],
  FINANCE_PENDING: ["DO_RECEIVED", "IN_STOCK"],
  DO_RECEIVED: ["SOLD", "IN_STOCK"],
  DELIVERED: ["SOLD"],
  SOLD: [],
  WRITTEN_OFF: [],
} as const

export const LEGAL_TRANSITION_ACTIONS: Readonly<
  Record<State, Readonly<Record<string, State>>>
> = {
  PURCHASED: { receiveStock: "IN_STOCK", approvedWriteOff: "WRITTEN_OFF" },
  IN_STOCK: {
    holdStock: "IN_STOCK",
    releaseStock: "IN_STOCK",
    sendRepair: "IN_REPAIR",
    placeReservation: "ADVANCE_PLACED",
    startFinance: "FINANCE_PENDING",
    completeImmediate: "SOLD",
    approvedWriteOff: "WRITTEN_OFF",
  },
  IN_REPAIR: { returnRepair: "IN_STOCK" },
  ADVANCE_PLACED: {
    expireReservation: "ADVANCE_EXPIRED",
    convertReservation: "SOLD",
    cancelRetained: "IN_STOCK",
    approvedRefundCancel: "IN_STOCK",
  },
  ADVANCE_EXPIRED: {
    convertReservation: "SOLD",
    cancelRetained: "IN_STOCK",
    approvedRefundCancel: "IN_STOCK",
  },
  FINANCE_PENDING: {
    recordDO: "DO_RECEIVED",
    approvedFinanceCorrection: "IN_STOCK",
  },
  DO_RECEIVED: {
    confirmDOAndHandover: "SOLD",
    approvedFinanceCorrection: "IN_STOCK",
  },
  DELIVERED: { normalizeDelivered: "SOLD" },
  SOLD: {},
  WRITTEN_OFF: {},
} as const

export type TransitionCheckOptions = {
  action?: string
  available?: boolean
  hasOpenRepair?: boolean
  hasOpenCommitment?: boolean
  hasOpenObligation?: boolean
  hasApproval?: boolean
  hasCompletionEvidence?: boolean
  hasHandoverEvidence?: boolean
  hasVerifiedDO?: boolean
  isDue?: boolean
}

/**
 * Checks whether a vehicle lifecycle transition from `from` to `to` is legal
 * under the 10-state machine and any supplied domain guards.
 */
export function canTransitionVehicleState(
  from: State,
  to: State,
  opts?: TransitionCheckOptions
): boolean {
  if (
    !Object.hasOwn(LEGAL_TRANSITIONS, from) ||
    !Object.hasOwn(LEGAL_TRANSITIONS, to)
  ) {
    return false
  }
  if (to === "DELIVERED") return false
  if (!LEGAL_TRANSITIONS[from].includes(to)) return false

  if (opts?.action !== undefined) {
    const actions = LEGAL_TRANSITION_ACTIONS[from]
    if (!Object.hasOwn(actions, opts.action) || actions[opts.action] !== to) {
      return false
    }
  }

  if (from === "DELIVERED" && to === "SOLD") {
    if (
      opts?.hasCompletionEvidence === false ||
      opts?.hasHandoverEvidence === false
    ) {
      return false
    }
  }

  if (to === "SOLD") {
    if (
      opts?.hasCompletionEvidence === false ||
      opts?.hasHandoverEvidence === false
    ) {
      return false
    }
    if (from === "IN_STOCK") {
      if (
        opts?.available === false ||
        opts?.hasOpenRepair === true ||
        opts?.hasOpenCommitment === true
      ) {
        return false
      }
    }
    if (from === "DO_RECEIVED" && opts?.hasVerifiedDO === false) {
      return false
    }
  }

  if (
    from === "IN_STOCK" &&
    (to === "ADVANCE_PLACED" || to === "FINANCE_PENDING")
  ) {
    if (
      opts?.available === false ||
      opts?.hasOpenRepair === true ||
      opts?.hasOpenCommitment === true
    ) {
      return false
    }
  }

  if (from === "IN_STOCK" && to === "IN_REPAIR") {
    if (opts?.hasOpenRepair === true || opts?.hasOpenCommitment === true) {
      return false
    }
  }

  if (from === "IN_STOCK" && to === "IN_STOCK") {
    if (
      opts?.action === "releaseStock" &&
      (opts?.hasOpenRepair === true || opts?.hasOpenCommitment === true)
    ) {
      return false
    }
  }

  if (from === "ADVANCE_PLACED" && to === "ADVANCE_EXPIRED") {
    if (opts?.isDue === false || opts?.hasOpenCommitment === false) {
      return false
    }
  }

  if (from === "FINANCE_PENDING" && to === "DO_RECEIVED") {
    if (opts?.hasVerifiedDO === false) {
      return false
    }
  }

  if (
    (from === "FINANCE_PENDING" || from === "DO_RECEIVED") &&
    to === "IN_STOCK"
  ) {
    if (opts?.hasApproval === false || opts?.hasOpenObligation === true) {
      return false
    }
  }

  if (to === "WRITTEN_OFF") {
    if (
      opts?.hasApproval === false ||
      opts?.hasOpenRepair === true ||
      opts?.hasOpenCommitment === true ||
      opts?.hasOpenObligation === true
    ) {
      return false
    }
  }

  return true
}

/**
 * Effective vehicle availability (S2): true ONLY when in IN_STOCK on an open
 * cycle, not held, with no open repair and no active/unresolved buyer commitment.
 * Expired unresolved advances remain in ADVANCE_EXPIRED and are unavailable.
 */
export function computeEffectiveAvailable(input: {
  status: State
  held: boolean
  hasOpenRepair: boolean
  hasActiveCommitment: boolean
  openCycle?: boolean
}): boolean {
  return (
    input.status === "IN_STOCK" &&
    input.openCycle !== false &&
    !input.held &&
    !input.hasOpenRepair &&
    !input.hasActiveCommitment
  )
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    default:
      return 31
  }
}

/** Parses and strictly validates a Gregorian `YYYY-MM-DD` date string. */
export function parseDateOnly(dateStr: string): {
  year: number
  month: number
  day: number
} {
  if (typeof dateStr !== "string") throw new TypeError("INVALID_INPUT")
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new RangeError("INVALID_INPUT")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new RangeError("INVALID_INPUT")
  }
  return { year, month, day }
}

/** Formats Gregorian year/month/day integers into canonical `YYYY-MM-DD`. */
export function formatDateOnly(
  year: number,
  month: number,
  day: number
): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Howard Hinnant civil-to-days algorithm (1970-01-01 -> 0), proleptic Gregorian. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Inverse of `daysFromCivil`: converts integer day count back to Gregorian Y/M/D. */
function civilFromDays(z: number): {
  year: number
  month: number
  day: number
} {
  const shifted = z + 719468
  const era = Math.floor(shifted / 146097)
  const doe = shifted - era * 146097
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  const year = y + (month <= 2 ? 1 : 0)
  return { year, month, day }
}

/** Exact Gregorian calendar day addition, independent of host timezone. */
export function addCalendarDays(dateStr: string, deltaDays: number): string {
  if (!Number.isInteger(deltaDays)) throw new RangeError("INVALID_INPUT")
  const { year, month, day } = parseDateOnly(dateStr)
  const next = civilFromDays(daysFromCivil(year, month, day) + deltaDays)
  return formatDateOnly(next.year, next.month, next.day)
}

/** Exact signed calendar day difference (`laterDate - earlierDate`). */
export function diffCalendarDays(
  laterDate: string,
  earlierDate: string
): number {
  const later = parseDateOnly(laterDate)
  const earlier = parseDateOnly(earlierDate)
  return (
    daysFromCivil(later.year, later.month, later.day) -
    daysFromCivil(earlier.year, earlier.month, earlier.day)
  )
}

const COLOMBO_OFFSET_MS = 330 * 60_000

function assertValidTimezone(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    throw new RangeError("INVALID_INPUT")
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
  } catch {
    throw new RangeError("INVALID_INPUT")
  }
}

function localPartsMs(formatter: Intl.DateTimeFormat, utcMs: number): number {
  const parts = formatter.formatToParts(new Date(utcMs))
  const map = new Map<string, number>()
  for (const part of parts) {
    if (part.type !== "literal") map.set(part.type, Number(part.value))
  }
  return Date.UTC(
    map.get("year") ?? 0,
    (map.get("month") ?? 1) - 1,
    map.get("day") ?? 1,
    map.get("hour") ?? 0,
    map.get("minute") ?? 0,
    map.get("second") ?? 0,
    0
  )
}

/**
 * Converts local `00:00:00.000` on `dateStr` in `timezone` to an exact UTC Date.
 * Uses fixed +05:30 offset for Asia/Colombo and Intl offset resolution for
 * other valid IANA timezones, with zero dependency on the host timezone.
 */
export function localMidnightToUtc(
  dateStr: string,
  timezone = COLOMBO_TIMEZONE
): Date {
  const { year, month, day } = parseDateOnly(dateStr)
  const targetUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  if (timezone === COLOMBO_TIMEZONE) {
    return new Date(targetUtcMidnight - COLOMBO_OFFSET_MS)
  }
  const formatter = assertValidTimezone(timezone)
  let guess = targetUtcMidnight
  for (let i = 0; i < 3; i++) {
    const observed = localPartsMs(formatter, guess)
    const diff = targetUtcMidnight - observed
    if (diff === 0) break
    guess += diff
  }
  return new Date(guess)
}

export type AdvanceTierRule = {
  upperBps: number | null
  days: number
}

export const DEFAULT_ADVANCE_TIERS: readonly AdvanceTierRule[] = [
  { upperBps: 500, days: 7 },
  { upperBps: 1000, days: 14 },
  { upperBps: 1500, days: 21 },
  { upperBps: null, days: 31 },
] as const

function validateAdvanceTiers(tiers: readonly AdvanceTierRule[]): void {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new RangeError("INVALID_INPUT")
  }
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    if (!Number.isInteger(tier.days) || tier.days < 1 || tier.days > 31) {
      throw new RangeError("INVALID_INPUT")
    }
    const isLast = i === tiers.length - 1
    if (isLast) {
      if (tier.upperBps !== null) throw new RangeError("INVALID_INPUT")
    } else {
      if (
        tier.upperBps === null ||
        !Number.isInteger(tier.upperBps) ||
        tier.upperBps < 0 ||
        tier.upperBps > 10000
      ) {
        throw new RangeError("INVALID_INPUT")
      }
      if (i > 0 && tier.upperBps <= (tiers[i - 1]?.upperBps ?? -1)) {
        throw new RangeError("INVALID_INPUT")
      }
    }
  }
}

export type AdvanceValidityInput = {
  advanceAmount: bigint
  listedPrice: bigint
  agreedPrice?: bigint
  placedDate: string
  tiers?: readonly AdvanceTierRule[]
  timezone?: string
  leadDays?: number
}

export type AdvanceValidityResult = {
  days: number
  tierUpperBps: number | null
  percentHundredths: bigint
  percentDisplay: string
  validThrough: string
  expiresAt: Date
  warningDate: string
  warningAt: Date
  timezone: string
  leadDays: number
}

/**
 * Computes exact advance reservation tier, display percentage, validThrough
 * calendar date, UTC expiry instant (next-day 00:00 in snapshot timezone), and
 * approaching-expiry warning window using exact bigint cross-multiplication.
 */
export function calculateAdvanceValidity(
  input: AdvanceValidityInput
): AdvanceValidityResult {
  const { advanceAmount, listedPrice, agreedPrice, placedDate } = input
  if (typeof advanceAmount !== "bigint" || typeof listedPrice !== "bigint") {
    throw new TypeError("INVALID_INPUT")
  }
  bounded(advanceAmount, A)
  bounded(listedPrice, A)
  if (advanceAmount <= 0n || listedPrice <= 0n) {
    throw new RangeError("INVALID_INPUT")
  }
  if (agreedPrice !== undefined) {
    if (typeof agreedPrice !== "bigint") throw new TypeError("INVALID_INPUT")
    bounded(agreedPrice, A)
    if (agreedPrice <= 0n || advanceAmount > agreedPrice) {
      throw new RangeError("INVALID_INPUT")
    }
  }

  const tiers = input.tiers ?? DEFAULT_ADVANCE_TIERS
  validateAdvanceTiers(tiers)

  const timezone = input.timezone ?? COLOMBO_TIMEZONE
  assertValidTimezone(timezone)

  const leadDays = input.leadDays ?? 3
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 7) {
    throw new RangeError("INVALID_INPUT")
  }

  const matched = tiers.find(
    (tier) =>
      tier.upperBps === null ||
      advanceAmount * 10000n <= listedPrice * BigInt(tier.upperBps)
  )
  if (!matched) throw new RangeError("INVALID_INPUT")

  const percentHundredths = roundRatio(advanceAmount * 10000n, listedPrice)
  const percentDisplay = `${percentHundredths / 100n}.${(percentHundredths % 100n).toString().padStart(2, "0")}%`

  const validThrough = addCalendarDays(placedDate, matched.days)
  const expiresAt = localMidnightToUtc(
    addCalendarDays(validThrough, 1),
    timezone
  )
  const warningDate = addCalendarDays(validThrough, -leadDays)
  const warningAt = localMidnightToUtc(warningDate, timezone)

  return {
    days: matched.days,
    tierUpperBps: matched.upperBps,
    percentHundredths,
    percentDisplay,
    validThrough,
    expiresAt,
    warningDate,
    warningAt,
    timezone,
    leadDays,
  }
}

/** Due iff `now >= expiresAt` (exact contract boundary per M3). */
export function isAdvanceExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime()
}

/**
 * Approaching-expiry warning is due iff `now >= warningAt && now < expiresAt`.
 * Once expired (`now >= expiresAt`), a late job emits expiry only, not an
 * obsolete approaching warning (M3).
 */
export function isWarningDue(input: {
  validThrough: string
  expiresAt?: Date
  now: Date
  leadDays?: number
  timezone?: string
}): boolean {
  const leadDays = input.leadDays ?? 3
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 7) {
    throw new RangeError("INVALID_INPUT")
  }
  const timezone = input.timezone ?? COLOMBO_TIMEZONE
  assertValidTimezone(timezone)
  const warningDate = addCalendarDays(input.validThrough, -leadDays)
  const warningAt = localMidnightToUtc(warningDate, timezone)
  const expiresAt =
    input.expiresAt ??
    localMidnightToUtc(addCalendarDays(input.validThrough, 1), timezone)
  const nowMs = input.now.getTime()
  return nowMs >= warningAt.getTime() && nowMs < expiresAt.getTime()
}

export type FacilityDeductionHandling = "WITHHELD" | "PAID_BY_DEALERSHIP"
export type FacilityFeeMode = "WITHHELD" | "SEPARATE"

export type FacilityDeductionInput = {
  label?: string
  amount: bigint
  recipient?: string
  handling: FacilityDeductionHandling
}

export type FacilityDisbursementInput = {
  gross: bigint
  deductions: readonly FacilityDeductionInput[]
  fee: bigint
  feeMode?: FacilityFeeMode
  separatelyRecoverableCharges?: bigint
}

export type FacilityDisbursementResult = {
  gross: bigint
  withheldDeductions: bigint
  paidByDealershipTotal: bigint
  withheldFee: bigint
  netDisbursed: bigint
  separatelyRecoverableCharges: bigint
  recoverablePrincipal: bigint
  recoverableCharges: bigint
  recoverableFee: bigint
  totalRecoverable: bigint
  totalCashOut: bigint
  feeMode: FacilityFeeMode
}

/**
 * Exact W12F cash facility payout and recoverable obligation math.
 *
 * - `netDisbursed = gross - withheldDeductions - withheldFee` (must be >= 0n)
 * - `0n <= separatelyRecoverableCharges <= paidByDealershipTotal`
 * - Per W12F: withheld third-party deductions and withheld fees are NOT
 *   dealership outflows or receivables; recoverable principal is `netDisbursed`,
 *   charges recoverable are `separatelyRecoverableCharges`, and fee is owed
 *   separately only when `feeMode === "SEPARATE"`.
 */
export function calculateFacilityDisbursement(
  input: FacilityDisbursementInput
): FacilityDisbursementResult {
  const {
    gross,
    deductions,
    fee,
    feeMode = "WITHHELD",
    separatelyRecoverableCharges = 0n,
  } = input

  if (
    typeof gross !== "bigint" ||
    typeof fee !== "bigint" ||
    typeof separatelyRecoverableCharges !== "bigint"
  ) {
    throw new TypeError("INVALID_INPUT")
  }
  bounded(gross, A)
  bounded(fee, A)
  bounded(separatelyRecoverableCharges, C)
  if (gross <= 0n || fee < 0n || separatelyRecoverableCharges < 0n) {
    throw new RangeError("INVALID_INPUT")
  }
  if (feeMode !== "WITHHELD" && feeMode !== "SEPARATE") {
    throw new RangeError("INVALID_INPUT")
  }

  const withheldAmounts: bigint[] = []
  const paidByDealershipAmounts: bigint[] = []
  for (const d of deductions) {
    if (typeof d.amount !== "bigint") throw new TypeError("INVALID_INPUT")
    bounded(d.amount, A)
    if (d.amount < 0n) throw new RangeError("INVALID_INPUT")
    if (d.handling === "WITHHELD") {
      withheldAmounts.push(d.amount)
    } else if (d.handling === "PAID_BY_DEALERSHIP") {
      paidByDealershipAmounts.push(d.amount)
    } else {
      throw new RangeError("INVALID_INPUT")
    }
  }

  const withheldDeductions = sum(withheldAmounts, C)
  const paidByDealershipTotal = sum(paidByDealershipAmounts, C)
  const withheldFee = feeMode === "WITHHELD" ? fee : 0n
  const netDisbursed = gross - withheldDeductions - withheldFee

  if (netDisbursed < 0n) {
    throw new RangeError("BALANCE_MISMATCH")
  }
  if (separatelyRecoverableCharges > paidByDealershipTotal) {
    throw new RangeError("BALANCE_MISMATCH")
  }

  const recoverablePrincipal = netDisbursed
  const recoverableCharges = separatelyRecoverableCharges
  const recoverableFee = feeMode === "SEPARATE" ? fee : 0n
  const totalRecoverable = bounded(
    recoverablePrincipal + recoverableCharges + recoverableFee,
    C
  )
  const totalCashOut = bounded(netDisbursed + paidByDealershipTotal, C)

  return {
    gross,
    withheldDeductions,
    paidByDealershipTotal,
    withheldFee,
    netDisbursed,
    separatelyRecoverableCharges,
    recoverablePrincipal,
    recoverableCharges,
    recoverableFee,
    totalRecoverable,
    totalCashOut,
    feeMode,
  }
}

export type FacilityObligationBuckets = {
  principal: bigint
  charges: bigint
  fee: bigint
}

export type FacilityRecoveryResult = {
  remainingBefore: FacilityObligationBuckets & { total: bigint }
  remainingAfter: FacilityObligationBuckets & { total: bigint }
  fullyRecovered: boolean
}

function assertNonNegativeBucket(
  value: bigint | undefined,
  bound: bigint
): bigint {
  const actual = value ?? 0n
  if (typeof actual !== "bigint") throw new TypeError("INVALID_INPUT")
  bounded(actual, bound)
  if (actual < 0n) throw new RangeError("INVALID_INPUT")
  return actual
}

/**
 * Exact W12F cash facility recovery remaining and component-cap validation.
 * Each recovery component (`principal`, `charges`, `fee`) is capped by its own
 * remaining obligation; excess throws `BALANCE_MISMATCH`.
 */
export function calculateFacilityRecovery(input: {
  obligations: FacilityObligationBuckets
  alreadyRecovered?: Partial<FacilityObligationBuckets>
  payment?: Partial<FacilityObligationBuckets>
}): FacilityRecoveryResult {
  const obPrincipal = assertNonNegativeBucket(input.obligations.principal, C)
  const obCharges = assertNonNegativeBucket(input.obligations.charges, C)
  const obFee = assertNonNegativeBucket(input.obligations.fee, C)

  const recPrincipal = assertNonNegativeBucket(
    input.alreadyRecovered?.principal,
    C
  )
  const recCharges = assertNonNegativeBucket(input.alreadyRecovered?.charges, C)
  const recFee = assertNonNegativeBucket(input.alreadyRecovered?.fee, C)

  if (recPrincipal > obPrincipal || recCharges > obCharges || recFee > obFee) {
    throw new RangeError("BALANCE_MISMATCH")
  }

  const remBeforePrincipal = obPrincipal - recPrincipal
  const remBeforeCharges = obCharges - recCharges
  const remBeforeFee = obFee - recFee
  const remBeforeTotal = bounded(
    remBeforePrincipal + remBeforeCharges + remBeforeFee,
    C
  )

  const payPrincipal = assertNonNegativeBucket(input.payment?.principal, A)
  const payCharges = assertNonNegativeBucket(input.payment?.charges, A)
  const payFee = assertNonNegativeBucket(input.payment?.fee, A)

  if (
    payPrincipal > remBeforePrincipal ||
    payCharges > remBeforeCharges ||
    payFee > remBeforeFee
  ) {
    throw new RangeError("BALANCE_MISMATCH")
  }

  const remAfterPrincipal = remBeforePrincipal - payPrincipal
  const remAfterCharges = remBeforeCharges - payCharges
  const remAfterFee = remBeforeFee - payFee
  const remAfterTotal = bounded(
    remAfterPrincipal + remAfterCharges + remAfterFee,
    C
  )

  return {
    remainingBefore: {
      principal: remBeforePrincipal,
      charges: remBeforeCharges,
      fee: remBeforeFee,
      total: remBeforeTotal,
    },
    remainingAfter: {
      principal: remAfterPrincipal,
      charges: remAfterCharges,
      fee: remAfterFee,
      total: remAfterTotal,
    },
    fullyRecovered: remAfterTotal === 0n,
  }
}

export type ReconciliationEntitlementState =
  | "OPEN"
  | "PARTIAL"
  | "SETTLED"
  | "RESOLVED"

export type ReconciliationResolutionKind =
  | "KEEP_OPEN"
  | "ACCEPT_SHORTFALL"
  | "CARRY_CREDIT"
  | "RETURN_OVERPAYMENT"

/**
 * Exact W13 reconciliation overdue check:
 * Overdue iff pending (`OPEN`/`PARTIAL`, `outstanding > 0`) AND not future
 * relative to `asOfDate` AND (`sentOrEligibleDate <= asOfDate - overdueDays`
 * OR `sentOrEligibleDate < lastReconciledSentDate`).
 */
export function isEntitlementOverdue(input: {
  sentOrEligibleDate: string
  asOfDate: string
  lastReconciledSentDate?: string | null
  overdueDays?: number
  state?: ReconciliationEntitlementState
  outstanding?: bigint
}): boolean {
  const overdueDays = input.overdueDays ?? 2
  if (!Number.isInteger(overdueDays) || overdueDays < 0) {
    throw new RangeError("INVALID_INPUT")
  }
  parseDateOnly(input.sentOrEligibleDate)
  parseDateOnly(input.asOfDate)
  if (input.lastReconciledSentDate != null) {
    parseDateOnly(input.lastReconciledSentDate)
  }

  if (input.state === "SETTLED" || input.state === "RESOLVED") {
    return false
  }
  if (input.outstanding !== undefined) {
    if (typeof input.outstanding !== "bigint") {
      throw new TypeError("INVALID_INPUT")
    }
    bounded(input.outstanding, C)
    if (input.outstanding <= 0n) return false
  }

  const daysElapsed = diffCalendarDays(input.asOfDate, input.sentOrEligibleDate)
  if (daysElapsed < 0) return false

  if (daysElapsed >= overdueDays) return true

  if (
    input.lastReconciledSentDate != null &&
    diffCalendarDays(input.lastReconciledSentDate, input.sentOrEligibleDate) > 0
  ) {
    return true
  }

  return false
}

export type WatermarkItem = {
  sentDate: string
  state: ReconciliationEntitlementState
  resolution?: ReconciliationResolutionKind | null
}

const CLOSING_RESOLUTIONS = new Set<ReconciliationResolutionKind>([
  "ACCEPT_SHORTFALL",
  "CARRY_CREDIT",
  "RETURN_OVERPAYMENT",
])

/**
 * Exact W13 company reconciliation watermark calculation:
 * Monotonically advances (`GREATEST`) across `SETTLED` and `RESOLVED`
 * (`ACCEPT_SHORTFALL`, `CARRY_CREDIT`, `RETURN_OVERPAYMENT`) items only.
 * Never advances on `OPEN`, `PARTIAL`, or `KEEP_OPEN`.
 */
export function computeNextWatermark(
  currentWatermark: string | null,
  items: readonly WatermarkItem[]
): string | null {
  if (currentWatermark !== null) {
    parseDateOnly(currentWatermark)
  }
  let next = currentWatermark

  for (const item of items) {
    parseDateOnly(item.sentDate)
    if (item.resolution === "KEEP_OPEN") continue

    const isSettled = item.state === "SETTLED"
    const isClosedResolution =
      item.state === "RESOLVED" &&
      (item.resolution == null || CLOSING_RESOLUTIONS.has(item.resolution))

    if (!isSettled && !isClosedResolution) continue

    if (next === null || item.sentDate > next) {
      next = item.sentDate
    }
  }

  return next
}
