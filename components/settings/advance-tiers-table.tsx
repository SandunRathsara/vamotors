"use client"

import * as React from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AdvanceTier {
  minPercent: number
  maxPercent: number
  validityDays: number
  validityLabel: string
}

interface AdvanceTiersTableProps {
  tiers: AdvanceTier[]
  onChange: (tiers: AdvanceTier[]) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdvanceTiersTable({ tiers, onChange }: AdvanceTiersTableProps) {
  function updateTier(index: number, patch: Partial<AdvanceTier>) {
    const next = tiers.map((t, i) => (i === index ? { ...t, ...patch } : t))
    onChange(next)
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs font-normal">Advance % Range</TableHead>
            <TableHead className="text-xs font-normal">Validity (Days)</TableHead>
            <TableHead className="text-xs font-normal">Validity Label</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tiers.map((tier, index) => (
            <TableRow key={index}>
              <TableCell className="text-sm text-muted-foreground">
                {tier.minPercent}% – {tier.maxPercent === 100 ? "100%" : `${tier.maxPercent}%`}
              </TableCell>
              <TableCell>
                <Input
                  type="number"
                  min={1}
                  value={tier.validityDays}
                  onChange={(e) =>
                    updateTier(index, { validityDays: parseInt(e.target.value, 10) || 0 })
                  }
                  className="h-7 w-20 text-sm"
                />
              </TableCell>
              <TableCell>
                <Input
                  type="text"
                  value={tier.validityLabel}
                  onChange={(e) => updateTier(index, { validityLabel: e.target.value })}
                  className="h-7 w-28 text-sm"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
