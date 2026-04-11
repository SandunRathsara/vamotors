import type { LeaseDispatch } from "./schemas"

export const leaseDispatchFixtures: LeaseDispatch[] = [
  { id: "ldisp-001", dealId: "ld-004", source: "VehicleSale", customerName: "Chamari Ranasinghe", financeCompanyName: "Sampath Leasing", fileNumber: "SPL2024-07-3456", status: "Dispatched", dispatchedAt: "2024-08-15T10:00:00Z", dispatchedBy: "u-004", trackingNumber: "SPL-DISP-1001" },
  { id: "ldisp-002", dealId: "ld-005", source: "VehicleSale", customerName: "Ruwan Gamage", financeCompanyName: "Central Finance Co. PLC", fileNumber: "CF2024-08-7890", status: "Dispatched", dispatchedAt: "2024-09-01T10:00:00Z", dispatchedBy: "u-004", trackingNumber: "CF-DISP-2201" },
  { id: "ldisp-003", dealId: "ld-006", source: "VehicleSale", customerName: "Waruni Dissanayake", financeCompanyName: "Nations Trust Bank PLC", fileNumber: "NTB2024-06-2345", status: "Dispatched", dispatchedAt: "2024-08-20T10:00:00Z", dispatchedBy: "u-007", trackingNumber: "NTB-DISP-0456" },
  { id: "ldisp-004", dealId: "ld-007", source: "VehicleSale", customerName: "Kalani Wijesinghe", financeCompanyName: "Mercantile Investments Ltd", fileNumber: "MIL2024-05-6789", status: "Dispatched", dispatchedAt: "2024-09-10T10:00:00Z", dispatchedBy: "u-007", trackingNumber: "MIL-DISP-3312" },
  { id: "ldisp-005", dealId: "ld-011", source: "Brokerage", customerName: "Rasika Palliyaguruge", financeCompanyName: "Mercantile Investments Ltd", fileNumber: "MIL2024-03-1122", status: "Dispatched", dispatchedAt: "2024-04-10T10:00:00Z", dispatchedBy: "u-004", trackingNumber: "MIL-DISP-1189" },
  { id: "ldisp-006", dealId: "ld-013", source: "Brokerage", customerName: "Nilupul Siriwardena", financeCompanyName: "Central Finance Co. PLC", fileNumber: "CF2024-07-3344", status: "Dispatched", dispatchedAt: "2024-08-05T10:00:00Z", dispatchedBy: "u-007", trackingNumber: "CF-DISP-2198" },
  { id: "ldisp-007", dealId: "ld-014", source: "Brokerage", customerName: "Asitha Gunathilake", financeCompanyName: "Senkadagala Finance PLC", fileNumber: "SK2024-01-7788", status: "Dispatched", dispatchedAt: "2024-02-10T10:00:00Z", dispatchedBy: "u-004", trackingNumber: "SK-DISP-0099" },
  { id: "ldisp-008", dealId: "ld-001", source: "VehicleSale", customerName: "Suresh Kumar Chandrasekaran", financeCompanyName: "People's Leasing & Finance PLC", fileNumber: "PLF2024-09-1234", status: "PendingDispatch" },
  { id: "ldisp-009", dealId: "ld-003", source: "VehicleSale", customerName: "Tharinda Pathirana", financeCompanyName: "LOLC Finance PLC", fileNumber: "CF2024-10-9012", status: "PendingDispatch" },
  { id: "ldisp-010", dealId: "ld-018", source: "Brokerage", customerName: "Hasitha Nanayakkara", financeCompanyName: "Central Finance Co. PLC", fileNumber: "CF2024-11-9900", status: "PendingDispatch" },
]
