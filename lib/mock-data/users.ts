import type { User } from "./schemas"

export const usersFixtures: User[] = [
  { id: "u-001", name: "Sandun Rathara", email: "sandun@vamotors.lk", role: "Administrator", status: "Active", lastLogin: "2024-11-11T08:30:00Z", createdAt: "2021-01-01T00:00:00Z" },
  { id: "u-002", name: "Roshan Fernando", email: "roshan.f@vamotors.lk", role: "Manager", status: "Active", lastLogin: "2024-11-10T17:15:00Z", createdAt: "2021-03-15T09:00:00Z" },
  { id: "u-003", name: "Dilhani Premarathna", email: "dilhani.p@vamotors.lk", role: "SalesExecutive", status: "Active", lastLogin: "2024-11-11T09:05:00Z", createdAt: "2022-06-01T09:00:00Z" },
  { id: "u-004", name: "Shanali Wickrama", email: "shanali.w@vamotors.lk", role: "FinanceOfficer", status: "Active", lastLogin: "2024-11-11T08:50:00Z", createdAt: "2022-08-15T09:00:00Z" },
  { id: "u-005", name: "Kasun Alahapperuma", email: "kasun.a@vamotors.lk", role: "SalesExecutive", status: "Active", lastLogin: "2024-11-08T18:00:00Z", createdAt: "2023-01-10T09:00:00Z" },
  { id: "u-006", name: "Chamari Ranasinghe", email: "chamari.r@vamotors.lk", role: "SalesExecutive", status: "Inactive", lastLogin: "2024-09-15T16:30:00Z", createdAt: "2022-11-01T09:00:00Z" },
  { id: "u-007", name: "Tharinda Pathirana", email: "tharinda.p@vamotors.lk", role: "FinanceOfficer", status: "Active", lastLogin: "2024-11-09T14:20:00Z", createdAt: "2023-04-01T09:00:00Z" },
  { id: "u-008", name: "Nuwan Rodrigo", email: "nuwan.r@vamotors.lk", role: "Manager", status: "Active", lastLogin: "2024-11-10T11:45:00Z", createdAt: "2021-07-01T09:00:00Z" },
]
