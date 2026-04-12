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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Add User</DialogTitle>
        </DialogHeader>
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
          <Button type="submit" form="add-user-form" disabled={isPending || !name || !email || !role || !password}>
            {isPending ? "Adding..." : "Add User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
