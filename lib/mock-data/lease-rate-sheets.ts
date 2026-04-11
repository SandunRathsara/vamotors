import type { LeaseRateSheet } from "./schemas"

export const leaseRateSheetsFixtures: LeaseRateSheet[] = [
  {
    id: "lrs-001", financeCompanyId: "tp-023", financeCompanyName: "People's Leasing & Finance PLC",
    vehicleModel: "Toyota Aqua", manufactureYear: 2020, maxLoanAmount: 40000000,
    rateCards: [
      { loanAmount: 20000000, periods: [{ months: 12, installment: 1820000 }, { months: 24, installment: 975000 }, { months: 36, installment: 695000 }, { months: 48, installment: 565000 }, { months: 60, installment: 480000 }] },
      { loanAmount: 30000000, periods: [{ months: 12, installment: 2730000 }, { months: 24, installment: 1465000 }, { months: 36, installment: 1042000 }, { months: 48, installment: 848000 }, { months: 60, installment: 720000 }] },
      { loanAmount: 40000000, periods: [{ months: 12, installment: 3640000 }, { months: 24, installment: 1953000 }, { months: 36, installment: 1390000 }, { months: 48, installment: 1130000 }, { months: 60, installment: 960000 }] },
    ],
  },
  {
    id: "lrs-002", financeCompanyId: "tp-023", financeCompanyName: "People's Leasing & Finance PLC",
    vehicleModel: "Honda Vezel", manufactureYear: 2022, maxLoanAmount: 80000000,
    rateCards: [
      { loanAmount: 40000000, periods: [{ months: 24, installment: 2100000 }, { months: 36, installment: 1520000 }, { months: 48, installment: 1240000 }, { months: 60, installment: 1065000 }] },
      { loanAmount: 60000000, periods: [{ months: 24, installment: 3150000 }, { months: 36, installment: 2280000 }, { months: 48, installment: 1860000 }, { months: 60, installment: 1598000 }] },
      { loanAmount: 80000000, periods: [{ months: 24, installment: 4200000 }, { months: 36, installment: 3040000 }, { months: 48, installment: 2480000 }, { months: 60, installment: 2130000 }] },
    ],
  },
  {
    id: "lrs-003", financeCompanyId: "tp-024", financeCompanyName: "Central Finance Co. PLC",
    vehicleModel: "Suzuki Swift", manufactureYear: 2020, maxLoanAmount: 45000000,
    rateCards: [
      { loanAmount: 20000000, periods: [{ months: 12, installment: 1850000 }, { months: 24, installment: 990000 }, { months: 36, installment: 708000 }, { months: 48, installment: 576000 }, { months: 60, installment: 490000 }] },
      { loanAmount: 30000000, periods: [{ months: 12, installment: 2775000 }, { months: 24, installment: 1485000 }, { months: 36, installment: 1062000 }, { months: 48, installment: 864000 }, { months: 60, installment: 735000 }] },
      { loanAmount: 45000000, periods: [{ months: 24, installment: 2228000 }, { months: 36, installment: 1593000 }, { months: 48, installment: 1296000 }, { months: 60, installment: 1103000 }] },
    ],
  },
  {
    id: "lrs-004", financeCompanyId: "tp-026", financeCompanyName: "LOLC Finance PLC",
    vehicleModel: "Hyundai Creta", manufactureYear: 2022, maxLoanAmount: 100000000,
    rateCards: [
      { loanAmount: 50000000, periods: [{ months: 24, installment: 2620000 }, { months: 36, installment: 1880000 }, { months: 48, installment: 1535000 }, { months: 60, installment: 1318000 }] },
      { loanAmount: 75000000, periods: [{ months: 24, installment: 3930000 }, { months: 36, installment: 2820000 }, { months: 48, installment: 2303000 }, { months: 60, installment: 1977000 }] },
      { loanAmount: 100000000, periods: [{ months: 36, installment: 3760000 }, { months: 48, installment: 3070000 }, { months: 60, installment: 2636000 }] },
    ],
  },
  {
    id: "lrs-005", financeCompanyId: "tp-030", financeCompanyName: "Sampath Leasing",
    vehicleModel: "Toyota Prius", manufactureYear: 2020, maxLoanAmount: 60000000,
    rateCards: [
      { loanAmount: 30000000, periods: [{ months: 12, installment: 2745000 }, { months: 24, installment: 1475000 }, { months: 36, installment: 1055000 }, { months: 48, installment: 860000 }, { months: 60, installment: 733000 }] },
      { loanAmount: 45000000, periods: [{ months: 24, installment: 2213000 }, { months: 36, installment: 1583000 }, { months: 48, installment: 1290000 }, { months: 60, installment: 1100000 }] },
      { loanAmount: 60000000, periods: [{ months: 24, installment: 2950000 }, { months: 36, installment: 2110000 }, { months: 48, installment: 1720000 }, { months: 60, installment: 1466000 }] },
    ],
  },
]
