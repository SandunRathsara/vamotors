"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { LeaseDealsTable } from "@/components/lease/lease-deals-table"

export default function LeaseDealsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lease Deals"
        description="Manage lease brokerage deals and applications"
      />
      <LeaseDealsTable />
    </div>
  )
}
