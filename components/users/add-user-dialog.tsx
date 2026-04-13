"use client"

import * as React from "react"

import { useEntityMutation } from "@/hooks/use-entity-mutation"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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

interface AddUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AddUserDialog({ open, onOpenChange }: AddUserDialogProps) {
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState("")
  const [password, setPassword] = React.useState("")

  const { mutate, isPending } = useEntityMutation({
    entityKey: "users",
    endpoint: "/api/users",
    method: "POST",
    successMessage: "User added.",
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !role || !password.trim()) return

    mutate(
      { name: name.trim(), email: email.trim(), role, password: password.trim() } as Parameters<typeof mutate>[0],
      {
        onSuccess: () => {
          onOpenChange(false)
          resetForm()
        },
      },
    )
  }

  function resetForm() {
    setName("")
    setEmail("")
    setRole("")
    setPassword("")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add User</SheetTitle>
          <SheetDescription>Create a new user account and assign a role</SheetDescription>
        </SheetHeader>
        <div className="px-1 pb-4">
          <form id="add-user-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-name" className="text-xs">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-email" className="text-xs">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@vamotors.lk"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-role" className="text-xs">
                Role <span className="text-destructive">*</span>
              </Label>
              <Select value={role} onValueChange={setRole} required>
                <SelectTrigger id="user-role">
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Administrator">Administrator</SelectItem>
                  <SelectItem value="Manager">Manager</SelectItem>
                  <SelectItem value="SalesExecutive">Sales Executive</SelectItem>
                  <SelectItem value="FinanceOfficer">Finance Officer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-password" className="text-xs">
                Password <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Set initial password"
                required
              />
            </div>
          </form>
          <div className="flex justify-end gap-2 pt-4">
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
            <Button type="submit" form="add-user-form" disabled={isPending || !name || !email || !role || !password}>
              {isPending ? "Adding..." : "Add User"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
