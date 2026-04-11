import type { Activity } from "./schemas"

export const activityFixtures: Activity[] = [
  { id: "act-001", timestamp: "2024-11-11T09:05:00Z", user: "Dilhani Premarathna", action: "Created sale", entity: "Sale S-060", detail: "Mitsubishi Delica D5 sold to Rasika Palliyaguruge for Rs. 11,880,000.00" },
  { id: "act-002", timestamp: "2024-11-11T08:50:00Z", user: "Shanali Wickrama", action: "Updated lease deal", entity: "Lease Deal LD-019", detail: "File number PLF2024-11-1234 assigned — Hyundai Starex application at People's Leasing" },
  { id: "act-003", timestamp: "2024-11-10T17:45:00Z", user: "Dilhani Premarathna", action: "Placed advance", entity: "Sale S-059", detail: "10% advance placed for Nissan Elgrand — Rs. 882,000.00 received from Shanali Wickrama" },
  { id: "act-004", timestamp: "2024-11-10T16:30:00Z", user: "Kasun Alahapperuma", action: "Added vehicle", entity: "Vehicle V-108", detail: "Hyundai i20 2021 White purchased from Southern Auto Hub for Rs. 2,450,000.00" },
  { id: "act-005", timestamp: "2024-11-10T15:00:00Z", user: "Shanali Wickrama", action: "Completed sale", entity: "Sale S-050", detail: "Nissan Kicks 2021 sold to Dilani Wickramasinghe for Rs. 6,480,000.00" },
  { id: "act-006", timestamp: "2024-11-09T14:20:00Z", user: "Tharinda Pathirana", action: "Recorded commission received", entity: "Reconciliation LR-012", detail: "LOLC Finance commission Rs. 924,000.00 received and reconciled" },
  { id: "act-007", timestamp: "2024-11-09T13:00:00Z", user: "Dilhani Premarathna", action: "Completed sale", entity: "Sale S-060", detail: "Mitsubishi Delica D5 — bank transfer confirmed from Rasika Palliyaguruge" },
  { id: "act-008", timestamp: "2024-11-08T11:30:00Z", user: "Dilhani Premarathna", action: "Submitted approval request", entity: "Approval AP-001", detail: "Discount request for Rs. 320,000.00 on Nissan Elgrand sale submitted for manager review" },
  { id: "act-009", timestamp: "2024-11-08T10:45:00Z", user: "Kasun Alahapperuma", action: "Added vehicle", entity: "Vehicle V-075", detail: "Nissan Juke 2020 Orange purchased from Southern Auto Hub for Rs. 5,100,000.00" },
  { id: "act-010", timestamp: "2024-11-08T09:00:00Z", user: "Shanali Wickrama", action: "Dispatched lease file", entity: "Lease Dispatch LDISP-008", detail: "People's Leasing file PLF2024-09-1234 marked pending dispatch — Toyota Corolla Axio" },
  { id: "act-011", timestamp: "2024-11-07T16:00:00Z", user: "Dilhani Premarathna", action: "Completed sale", entity: "Sale S-054", detail: "KIA Sportage 2021 sold to Prasanna Wimalasiri for Rs. 9,700,000.00" },
  { id: "act-012", timestamp: "2024-11-07T14:30:00Z", user: "Roshan Fernando", action: "Approved request", entity: "Approval AP-011", detail: "Discount of Rs. 300,000.00 approved for Toyota Hilux sale S-047" },
  { id: "act-013", timestamp: "2024-11-06T11:00:00Z", user: "Shanali Wickrama", action: "Submitted approval request", entity: "Approval AP-003", detail: "Advance refund request submitted for sale S-057 — Rs. 137,500.00" },
  { id: "act-014", timestamp: "2024-11-06T10:00:00Z", user: "Dilhani Premarathna", action: "Completed sale", entity: "Sale S-055", detail: "Toyota Vellfire 2016 sold to Buddhika Jayalath for Rs. 19,000,000.00" },
  { id: "act-015", timestamp: "2024-11-05T15:30:00Z", user: "Kasun Alahapperuma", action: "Completed sale", entity: "Sale S-048", detail: "Mahindra XUV 300 sold to Tharushi Edirisinghe for Rs. 5,600,000.00" },
  { id: "act-016", timestamp: "2024-11-05T10:00:00Z", user: "Roshan Fernando", action: "Submitted write-off request", entity: "Approval AP-004", detail: "Write-off request for Toyota Prado 2012 (V-062) — engine seized" },
  { id: "act-017", timestamp: "2024-11-04T14:00:00Z", user: "Shanali Wickrama", action: "Updated lease deal", entity: "Lease Deal LD-018", detail: "Documents collected for Honda Odyssey lease — file CF2024-11-9900 assigned" },
  { id: "act-018", timestamp: "2024-11-04T10:15:00Z", user: "Dilhani Premarathna", action: "Placed advance", entity: "Sale S-058", detail: "15% advance placed for Honda Odyssey — Rs. 1,057,500.00 from Roshani Kumarihami" },
  { id: "act-019", timestamp: "2024-11-03T16:00:00Z", user: "Tharinda Pathirana", action: "Completed sale", entity: "Sale S-053", detail: "Hyundai Santa Fe sold to Nuwan Rodrigo for Rs. 11,050,000.00" },
  { id: "act-020", timestamp: "2024-11-03T09:30:00Z", user: "Kasun Alahapperuma", action: "Added repair", entity: "Repair R-006", detail: "Honda Crossroad V-112 sent to Star Auto Garage for timing belt replacement" },
]
