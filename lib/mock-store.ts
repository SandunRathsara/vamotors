import type {
  Vehicle, Customer, Sale, Repair, Approval, ThirdParty,
  LeaseDeal, Notification, User, CashFlowEntry,
  LeaseDispatch, LeaseReconciliation, LeaseRateSheet, Settings, PaginatedResponse,
} from "./mock-data/schemas"
import { vehicleFixtures } from "./mock-data/vehicles"
import { customerFixtures } from "./mock-data/customers"
import { salesFixtures } from "./mock-data/sales"
import { repairsFixtures } from "./mock-data/repairs"
import { approvalsFixtures } from "./mock-data/approvals"
import { thirdPartiesFixtures } from "./mock-data/third-parties"
import { leaseDealsFixtures } from "./mock-data/lease-deals"
import { notificationsFixtures } from "./mock-data/notifications"
import { usersFixtures } from "./mock-data/users"
import { settingsFixture } from "./mock-data/settings"
import { cashFlowFixtures } from "./mock-data/cash-flow"
import { leaseDispatchFixtures } from "./mock-data/lease-dispatch"
import { leaseReconciliationFixtures } from "./mock-data/lease-reconciliation"
import { leaseRateSheetsFixtures } from "./mock-data/lease-rate-sheets"

// ── Generic CRUD store ────────────────────────────────────────────────────────

export type QueryParams = {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: "asc" | "desc"
  q?: string
  filters?: Record<string, string>
}

export class MockStore<T extends { id: string }> {
  private map: Map<string, T>
  private readonly initial: T[]

  constructor(fixtures: T[]) {
    this.initial = fixtures
    this.map = new Map(fixtures.map((item) => [item.id, structuredClone(item)]))
  }

  /** Rehydrate to initial fixtures. Used by POST /api/__test__/reset (D-14). */
  reset(): void {
    this.map = new Map(
      this.initial.map((item) => [item.id, structuredClone(item)])
    )
  }

  getAll(): T[] {
    return Array.from(this.map.values())
  }

  getById(id: string): T | null {
    return this.map.get(id) ?? null
  }

  create(item: T): T {
    const copy = structuredClone(item)
    this.map.set(copy.id, copy)
    return copy
  }

  update(id: string, patch: Partial<T>): T | null {
    const existing = this.map.get(id)
    if (!existing) return null
    const updated = { ...existing, ...patch, id } as T
    this.map.set(id, updated)
    return updated
  }

  delete(id: string): boolean {
    return this.map.delete(id)
  }

  query(params: QueryParams = {}): PaginatedResponse<T> {
    const { page = 1, pageSize = 20, sortBy, sortDir = "asc", q, filters } = params
    let items = Array.from(this.map.values())

    // Full-text search across all string-valued top-level fields
    if (q && q.trim() !== "") {
      const lower = q.toLowerCase()
      items = items.filter((item) =>
        Object.values(item).some(
          (v) => typeof v === "string" && v.toLowerCase().includes(lower)
        )
      )
    }

    // Exact match filters
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "") {
          items = items.filter((item) => {
            const fieldValue = (item as Record<string, unknown>)[key]
            return String(fieldValue) === value
          })
        }
      }
    }

    // Sorting
    if (sortBy) {
      items = [...items].sort((a, b) => {
        const aVal = (a as Record<string, unknown>)[sortBy]
        const bVal = (b as Record<string, unknown>)[sortBy]
        let comparison = 0
        if (typeof aVal === "number" && typeof bVal === "number") {
          comparison = aVal - bVal
        } else {
          comparison = String(aVal ?? "").localeCompare(String(bVal ?? ""))
        }
        return sortDir === "desc" ? -comparison : comparison
      })
    }

    const total = items.length
    const start = (page - 1) * pageSize
    const data = items.slice(start, start + pageSize)

    return { data, total, page, pageSize }
  }
}

// ── Settings store (singleton) ────────────────────────────────────────────────

class SettingsStore {
  private data: Settings
  private readonly initial: Settings

  constructor(initial: Settings) {
    this.initial = initial
    this.data = structuredClone(initial)
  }

  get(): Settings {
    return structuredClone(this.data)
  }

  update(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch }
    return structuredClone(this.data)
  }

  /** Rehydrate to initial fixture. Used by POST /api/__test__/reset (D-14). */
  reset(): void {
    this.data = structuredClone(this.initial)
  }
}

// ── Store instances (module-scoped singletons) ─────────────────────────────────

export const vehiclesStore = new MockStore<Vehicle>(vehicleFixtures)
export const customersStore = new MockStore<Customer>(customerFixtures)
export const salesStore = new MockStore<Sale>(salesFixtures)
export const repairsStore = new MockStore<Repair>(repairsFixtures)
export const approvalsStore = new MockStore<Approval>(approvalsFixtures)
export const leaseDealsStore = new MockStore<LeaseDeal>(leaseDealsFixtures)
export const thirdPartiesStore = new MockStore<ThirdParty>(thirdPartiesFixtures)
export const notificationsStore = new MockStore<Notification>(notificationsFixtures)
export const usersStore = new MockStore<User>(usersFixtures)
export const cashFlowStore = new MockStore<CashFlowEntry>(cashFlowFixtures)
export const leaseDispatchStore = new MockStore<LeaseDispatch>(leaseDispatchFixtures)
export const leaseReconciliationStore = new MockStore<LeaseReconciliation>(leaseReconciliationFixtures)
export const leaseRateSheetsStore = new MockStore<LeaseRateSheet>(leaseRateSheetsFixtures)
export const settingsStore = new SettingsStore(settingsFixture)

/**
 * Rehydrate every mock store to its initial fixtures.
 * Called by `POST /api/__test__/reset` (D-14, Phase 0.3). Contract is stable:
 * when Phase 1+ swaps to Prisma, this function's body becomes
 * `await prisma.$transaction([...deleteMany])` but the callers do not change.
 */
export function resetAll(): void {
  vehiclesStore.reset()
  customersStore.reset()
  salesStore.reset()
  repairsStore.reset()
  approvalsStore.reset()
  leaseDealsStore.reset()
  thirdPartiesStore.reset()
  notificationsStore.reset()
  usersStore.reset()
  cashFlowStore.reset()
  leaseDispatchStore.reset()
  leaseReconciliationStore.reset()
  leaseRateSheetsStore.reset()
  settingsStore.reset()
}
