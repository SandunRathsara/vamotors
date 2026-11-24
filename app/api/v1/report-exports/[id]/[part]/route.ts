import { reportExportEndpoint } from "@/lib/server/report-http"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; part: string }> }
) {
  const { id, part } = await params
  return reportExportEndpoint(request, id, part)
}
