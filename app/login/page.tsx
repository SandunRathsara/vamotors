"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { privateRequest, safeReturnPath } from "@/lib/security-client"
import { Car } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function LoginPage() {
  return (
    <Suspense fallback={<p role="status">Loading sign in…</p>}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const queries = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const reason = useSearchParams().get("reason")
  const notice =
    reason === "inactive"
      ? "This account is inactive. Contact an administrator."
      : reason === "forbidden"
        ? "Administrator access is required for that page."
        : reason === "access-changed"
          ? "Access changed or your session ended. Please sign in again."
          : ""

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fields = new FormData(form)
    setPending(true)
    setError("")
    queries.clear()
    try {
      await privateRequest("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fields.get("email"),
          password: fields.get("password"),
          rememberMe: fields.get("remember") === "on",
        }),
      })
      form.reset()
      const channel = new BroadcastChannel("vamotors-auth")
      channel.postMessage("changed")
      channel.close()
      window.location.replace(
        safeReturnPath(
          new URLSearchParams(window.location.search).get("returnTo")
        )
      )
    } catch {
      setError(
        "Sign in failed. Check your credentials or contact an administrator."
      )
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-sm px-4">
      <div className="mb-8 flex items-center justify-center gap-2">
        <Car className="h-6 w-6 text-primary" />
        <span className="text-xl font-semibold">VA Motors</span>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-semibold">
            Sign in to VA Motors
          </CardTitle>
          <CardDescription className="text-sm">
            Enter your credentials to access the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs">
                Email Address
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@vamotors.lk"
                required
                autoComplete="email"
                className="h-9"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="remember" name="remember" />
              <Label
                htmlFor="remember"
                className="cursor-pointer text-xs font-normal"
              >
                Remember me
              </Label>
            </div>

            {(error || notice) && (
              <p role="alert" className="text-sm text-destructive">
                {error || notice}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
