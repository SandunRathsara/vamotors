"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { PurchaseForm } from "./purchase-form"

interface RecordPurchaseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecordPurchaseSheet({ open, onOpenChange }: RecordPurchaseSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Record Purchase</SheetTitle>
          <SheetDescription>Add a new vehicle purchase to inventory</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <PurchaseForm />
        </div>
      </SheetContent>
    </Sheet>
  )
}
