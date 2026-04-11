import type { Settings } from "./schemas"

export const settingsFixture: Settings = {
  companyName: "VA Motors",
  companyPhone: "+94112345678",
  companyAddress: "123, Galle Road, Colombo 03, Sri Lanka",
  companyEmail: "info@vamotors.lk",
  currencyCode: "LKR",
  currencySymbol: "Rs.",
  currencyDecimalPlaces: 2,
  currencyFormat: "symbol-space-amount",
  advancePaymentTiers: [
    { minPercent: 0, maxPercent: 5, validityDays: 7, validityLabel: "1 Week" },
    { minPercent: 5, maxPercent: 10, validityDays: 14, validityLabel: "2 Weeks" },
    { minPercent: 10, maxPercent: 15, validityDays: 21, validityLabel: "3 Weeks" },
    { minPercent: 15, maxPercent: 100, validityDays: 30, validityLabel: "1 Month" },
  ],
  defaultTheme: "System",
  itemsPerPage: 20,
  dateFormat: "DD/MM/YYYY",
}
