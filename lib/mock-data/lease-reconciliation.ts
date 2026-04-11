import type { LeaseReconciliation } from "./schemas"

export const leaseReconciliationFixtures: LeaseReconciliation[] = [
  { id: "lr-001", date: "2024-09-30", source: "VehicleSale", entity: "Ruwan Gamage", dealRef: "CF2024-08-7890", expectedCommission: 900000, receivedCommission: 900000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-002", date: "2024-10-15", source: "VehicleSale", entity: "Kalani Wijesinghe", dealRef: "MIL2024-05-6789", expectedCommission: 1736000, receivedCommission: 1736000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-003", date: "2024-09-28", source: "VehicleSale", entity: "Waruni Dissanayake", dealRef: "NTB2024-06-2345", expectedCommission: 684000, receivedCommission: 684000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-004", date: "2024-04-30", source: "Brokerage", entity: "Rasika Palliyaguruge", dealRef: "MIL2024-03-1122", expectedCommission: 1540000, receivedCommission: 1400000, discrepancy: 140000, status: "Reconciled" },
  { id: "lr-005", date: "2024-08-31", source: "Brokerage", entity: "Nilupul Siriwardena", dealRef: "CF2024-07-3344", expectedCommission: 1350000, receivedCommission: 1350000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-006", date: "2024-03-20", source: "Brokerage", entity: "Asitha Gunathilake", dealRef: "SK2024-01-7788", expectedCommission: 1347500, receivedCommission: 1347500, discrepancy: 0, status: "Reconciled" },
  { id: "lr-007", date: "2024-10-31", source: "VehicleSale", entity: "Chamari Ranasinghe", dealRef: "SPL2024-07-3456", expectedCommission: 736000, receivedCommission: undefined, discrepancy: undefined, status: "Overdue" },
  { id: "lr-008", date: "2024-11-15", source: "VehicleSale", entity: "Suresh Kumar Chandrasekaran", dealRef: "PLF2024-09-1234", expectedCommission: 875000, receivedCommission: undefined, discrepancy: undefined, status: "Pending" },
  { id: "lr-009", date: "2024-11-30", source: "VehicleSale", entity: "Tharinda Pathirana", dealRef: "CF2024-10-9012", expectedCommission: 756000, receivedCommission: undefined, discrepancy: undefined, status: "Pending" },
  { id: "lr-010", date: "2024-11-15", source: "Brokerage", entity: "Hasitha Nanayakkara", dealRef: "CF2024-11-9900", expectedCommission: 1560000, receivedCommission: undefined, discrepancy: undefined, status: "Pending" },
  { id: "lr-011", date: "2024-10-31", source: "Brokerage", entity: "Nilupul Siriwardena (Part 2)", dealRef: "MIL2024-10-4456", expectedCommission: 1100000, receivedCommission: undefined, discrepancy: undefined, status: "Overdue" },
  { id: "lr-012", date: "2024-09-30", source: "VehicleSale", entity: "Thisara Gunasekera", dealRef: "LOLC2024-10-9012", expectedCommission: 924000, receivedCommission: 924000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-013", date: "2024-08-31", source: "Brokerage", entity: "Prasanna Wimalasiri", dealRef: "NTB2024-08-5566", expectedCommission: 810000, receivedCommission: 810000, discrepancy: 0, status: "Reconciled" },
  { id: "lr-014", date: "2024-11-30", source: "Brokerage", entity: "Sithara Dassanayake", dealRef: "PLF2024-11-5566", expectedCommission: 2375000, receivedCommission: undefined, discrepancy: undefined, status: "Pending" },
  { id: "lr-015", date: "2024-10-31", source: "VehicleSale", entity: "Waruni Dissanayake (Brokerage)", dealRef: "SPL2024-10-6677", expectedCommission: 644000, receivedCommission: undefined, discrepancy: undefined, status: "Overdue" },
]
