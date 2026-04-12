"use client"

import * as React from "react"

import { useEntityMutation } from "@/hooks/use-entity-mutation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface AddCustomerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddCustomerDialog({ open, onOpenChange }: AddCustomerDialogProps) {
  const [fullName, setFullName] = React.useState("")
  const [callingName, setCallingName] = React.useState("")
  const [nicPassport, setNicPassport] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [drivingLicence, setDrivingLicence] = React.useState("")

  const { mutate, isPending } = useEntityMutation({
    entityKey: "customers",
    endpoint: "/api/customers",
    method: "POST",
    successMessage: "Customer added successfully.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !nicPassport.trim() || !address.trim() || !phone.trim()) return

    mutate(
      {
        fullName: fullName.trim(),
        callingName: callingName.trim() || fullName.trim(),
        nicPassport: nicPassport.trim(),
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        drivingLicence: drivingLicence.trim() || undefined,
      } as Parameters<typeof mutate>[0],
      {
        onSuccess: () => {
          onOpenChange(false)
          resetForm()
        },
      },
    )
  }

  function resetForm() {
    setFullName("")
    setCallingName("")
    setNicPassport("")
    setAddress("")
    setPhone("")
    setEmail("")
    setDrivingLicence("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add Customer</DialogTitle>
        </DialogHeader>
        <form id="add-customer-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="fullName" className="text-xs">
                Full Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full legal name"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="callingName" className="text-xs">
                Calling Name
              </Label>
              <Input
                id="callingName"
                value={callingName}
                onChange={(e) => setCallingName(e.target.value)}
                placeholder="Preferred name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nicPassport" className="text-xs">
                NIC / Passport <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nicPassport"
                value={nicPassport}
                onChange={(e) => setNicPassport(e.target.value)}
                placeholder="NIC or passport number"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone" className="text-xs">
                Phone <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+94771234567"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="optional"
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="address" className="text-xs">
                Address <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Full address"
                rows={2}
                required
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="drivingLicence" className="text-xs">
                Driving Licence
              </Label>
              <Input
                id="drivingLicence"
                value={drivingLicence}
                onChange={(e) => setDrivingLicence(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onOpenChange(false)
              resetForm()
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="add-customer-form" disabled={isPending}>
            {isPending ? "Adding..." : "Add Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
