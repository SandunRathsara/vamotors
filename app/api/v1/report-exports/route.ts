import { reportExportEndpoint } from "@/lib/server/report-http"

export function GET(request: Request) {
  return reportExportEndpoint(request)
}
export const POST = GET
