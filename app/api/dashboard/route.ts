import { dashboardEndpoint } from "@/lib/server/report-http"

export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  return dashboardEndpoint(request)
}
