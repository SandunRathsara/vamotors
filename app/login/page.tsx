"use client"

import { useRouter } from "next/navigation"
import { Car } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function LoginPage() {
  const router = useRouter()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    router.push("/dashboard")
  }

  return (
    <div className="w-full max-w-sm px-4">
      <div className="flex items-center justify-center gap-2 mb-8">
        <Car className="h-6 w-6 text-primary" />
        <span className="text-xl font-semibold">VA Motors</span>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-semibold">Sign in to VA Motors</CardTitle>
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
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-9"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox id="remember" />
              <Label htmlFor="remember" className="text-xs font-normal cursor-pointer">
                Remember me
              </Label>
            </div>

            <Button type="submit" className="w-full">
              Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
