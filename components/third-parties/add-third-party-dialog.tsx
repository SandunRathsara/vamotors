"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

type ThirdPartyType = "Supplier" | "RepairVendor" | "FinanceCompany"

interface ContactPerson {
  name: string
  phone: string
  email: string
  role: string
}

interface AddThirdPartyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EMPTY_CONTACT = (): ContactPerson => ({ name: "", phone: "", email: "", role: "" })

export function AddThirdPartyDialog({ open, onOpenChange }: AddThirdPartyDialogProps) {
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<ThirdPartyType>("Supplier")
  const [category, setCategory] = React.useState("")
  const [commissionRate, setCommissionRate] = React.useState("")
  const [processingPathType, setProcessingPathType] = React.useState<"Application" | "Referral">("Application")
  const [contacts, setContacts] = React.useState<ContactPerson[]>([EMPTY_CONTACT()])

  const { mutate, isPending } = useEntityMutation({
    entityKey: "third-parties",
    endpoint: "/api/third-parties",
    method: "POST",
    successMessage: "Third party added.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    const validContacts = contacts.filter((c) => c.name.trim() && c.phone.trim())

    const payload: Record<string, unknown> = {
      name: name.trim(),
      type,
      isActive: true,
      contactPersons: validContacts.map((c) => ({
        name: c.name.trim(),
        phone: c.phone.trim(),
        email: c.email.trim() || undefined,
        role: c.role.trim() || "Contact",
      })),
    }

    if (category.trim()) payload.category = category.trim()

    if (type === "FinanceCompany") {
      if (commissionRate) payload.commissionRate = parseFloat(commissionRate)
      payload.processingPathType = processingPathType
    }

    mutate(payload as Parameters<typeof mutate>[0], {
      onSuccess: () => {
        onOpenChange(false)
        resetForm()
      },
    })
  }

  function resetForm() {
    setName("")
    setType("Supplier")
    setCategory("")
    setCommissionRate("")
    setProcessingPathType("Application")
    setContacts([EMPTY_CONTACT()])
  }

  function addContact() {
    setContacts((prev) => [...prev, EMPTY_CONTACT()])
  }

  function removeContact(index: number) {
    setContacts((prev) => prev.filter((_, i) => i !== index))
  }

  function updateContact(index: number, field: keyof ContactPerson, value: string) {
    setContacts((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add Third Party</DialogTitle>
        </DialogHeader>
        <form id="add-third-party-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Basic info */}
          <div className="space-y-1.5">
            <Label htmlFor="tp-name" className="text-xs">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Company or individual name"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tp-type" className="text-xs">
                Type <span className="text-destructive">*</span>
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as ThirdPartyType)}>
                <SelectTrigger id="tp-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Supplier">Supplier</SelectItem>
                  <SelectItem value="RepairVendor">Repair Vendor</SelectItem>
                  <SelectItem value="FinanceCompany">Finance Company</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tp-category" className="text-xs">
                Category
              </Label>
              <Input
                id="tp-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={
                  type === "Supplier"
                    ? "Individual / Company"
                    : type === "RepairVendor"
                    ? "Mechanical, Body & Paint…"
                    : "optional"
                }
              />
            </div>
          </div>

          {/* Finance Company conditional fields */}
          {type === "FinanceCompany" && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 bg-muted/30">
              <div className="space-y-1.5">
                <Label htmlFor="tp-commission" className="text-xs">
                  Commission Rate (%)
                </Label>
                <Input
                  id="tp-commission"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={commissionRate}
                  onChange={(e) => setCommissionRate(e.target.value)}
                  placeholder="e.g. 2.5"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tp-processing" className="text-xs">
                  Processing Path
                </Label>
                <Select
                  value={processingPathType}
                  onValueChange={(v) => setProcessingPathType(v as "Application" | "Referral")}
                >
                  <SelectTrigger id="tp-processing">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Application">Application</SelectItem>
                    <SelectItem value="Referral">Referral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Contact Persons */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-normal text-muted-foreground">Contact Persons</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={addContact}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Contact
              </Button>
            </div>

            <Separator />

            <div className="space-y-4">
              {contacts.map((contact, index) => (
                <div key={index} className="space-y-2 rounded-lg border p-3 relative">
                  {contacts.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => removeContact(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Remove contact</span>
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2 pr-6">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={contact.name}
                        onChange={(e) => updateContact(index, "name", e.target.value)}
                        placeholder="Contact name"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Role</Label>
                      <Input
                        value={contact.role}
                        onChange={(e) => updateContact(index, "role", e.target.value)}
                        placeholder="e.g. Manager"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Phone</Label>
                      <Input
                        type="tel"
                        value={contact.phone}
                        onChange={(e) => updateContact(index, "phone", e.target.value)}
                        placeholder="+94771234567"
                        className="h-8"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Email</Label>
                      <Input
                        type="email"
                        value={contact.email}
                        onChange={(e) => updateContact(index, "email", e.target.value)}
                        placeholder="optional"
                        className="h-8"
                      />
                    </div>
                  </div>
                </div>
              ))}
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
          <Button type="submit" form="add-third-party-form" disabled={isPending}>
            {isPending ? "Adding..." : "Add Third Party"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
