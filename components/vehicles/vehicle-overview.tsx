"use client"

import * as React from "react"
import { format } from "date-fns"

import type { Vehicle } from "@/lib/mock-data/schemas"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { FileDropzone, type FilePreview } from "@/components/shared/file-dropzone"

interface VehicleOverviewProps {
  vehicle: Vehicle
}

function SpecRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      <span className="text-sm font-normal">{value ?? "—"}</span>
    </div>
  )
}

export function VehicleOverview({ vehicle }: VehicleOverviewProps) {
  const [photoFiles, setPhotoFiles] = React.useState<FilePreview[]>([])

  const sortedMileage = [...vehicle.mileageHistory].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  return (
    <div className="space-y-6">
      {/* Technical Specs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Technical Specifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <SpecRow label="Make" value={vehicle.make} />
            <SpecRow label="Model" value={vehicle.model} />
            <SpecRow label="Year" value={vehicle.year} />
            <SpecRow label="Colour" value={vehicle.colour} />
            <SpecRow label="Engine No." value={vehicle.engineNumber} />
            <SpecRow label="Chassis No." value={vehicle.chassisNumber} />
            <SpecRow label="VIN" value={vehicle.vin} />
            <SpecRow label="CR No." value={vehicle.crNumber} />
            <SpecRow label="Fuel Type" value={vehicle.fuelType} />
            <SpecRow label="Transmission" value={vehicle.transmission} />
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Mileage History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Mileage History</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedMileage.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-normal">Date</TableHead>
                  <TableHead className="text-xs font-normal">Reading (km)</TableHead>
                  <TableHead className="text-xs font-normal">Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMileage.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">
                      {format(new Date(entry.date), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {entry.reading.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.remark ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No mileage history recorded.</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Photos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Photos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {vehicle.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {vehicle.photos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative aspect-video overflow-hidden rounded-md border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url || "/placeholder.svg"}
                    alt={photo.filename}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          )}
          <FileDropzone
            files={photoFiles}
            onFilesChange={setPhotoFiles}
            accept="image/*"
            maxSizeMB={2}
          />
        </CardContent>
      </Card>
    </div>
  )
}
