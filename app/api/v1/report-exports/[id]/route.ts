import { reportExportEndpoint } from "@/lib/server/report-http"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return reportExportEndpoint(request, (await params).id)
}
export const POST = GET
