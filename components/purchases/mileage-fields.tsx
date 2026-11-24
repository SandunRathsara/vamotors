"use client"

import { useId } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { privateRequest } from "@/lib/security-client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Cycle = Visible<PurchaseCycleDTO>

export function useVehicleMileage(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ["inventory", "detail", vehicleId],
    enabled: !!vehicleId,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { cycles?: Cycle[] } }>(
        `/api/v1/queries/vehicle?id=${encodeURIComponent(vehicleId!)}`
      ),
  })
}

export function mileageDecreased(
  cycles: Cycle[],
  reading: string,
  date: string
) {
  if (!reading.trim() || !date) return false
  const previous = cycles
    .flatMap((cycle) => cycle.mileage ?? [])
    .filter(
      (entry): entry is typeof entry & { date: string; reading: number } =>
        !!entry.date && entry.date <= date && entry.reading !== undefined
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.id ?? "").localeCompare(b.id ?? "")
    )
    .at(-1)
  return previous?.reading !== undefined && Number(reading) < previous.reading
}

export function useAcquisitionMileage(
  engine: string | undefined,
  chassis: string | undefined,
  reading: string,
  date: string,
  enabled = true
) {
  const ready = enabled && !!engine?.trim() && !!chassis?.trim() && !!date
  const identity = useQuery({
    queryKey: ["inventory", "identity", engine, chassis],
    enabled: ready,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { id: string } | null }>(
        `/api/v1/queries/vehicleIdentity?engineNumber=${encodeURIComponent(engine!)}&chassisNumber=${encodeURIComponent(chassis!)}`
      ),
  })
  const mileage = useVehicleMileage(ready ? identity.data?.data?.id : undefined)
  return {
    checking: ready && (identity.isFetching || mileage.isFetching),
    decreased: mileageDecreased(mileage.data?.data.cycles ?? [], reading, date),
  }
}

export function MileageDecreaseReason({
  value,
  onChange,
  disabled,
  name,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  name?: string
}) {
  const id = useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Reason for a mileage decrease *</Label>
      <Input
        id={id}
        name={name}
        required
        disabled={disabled}
        maxLength={2000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 text-base"
      />
    </div>
  )
}
