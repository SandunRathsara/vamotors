import { subject } from "@casl/ability"
import { z } from "zod"
import { authenticate, currentActor } from "@/lib/server/actor"
import { assertEnvironment, database } from "@/lib/server/db"
import { fail } from "@/lib/server/errors"
import { endpoint } from "@/lib/server/http"
import { adapterFor } from "@/lib/server/import-adapters"
import { generateImportTemplateCsv } from "@/lib/server/import-parsers"
import { generateImportTemplateXlsx } from "@/lib/server/import-template"
import { importTypes } from "@/lib/server/validators"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    const params = new URL(request.url).searchParams
    const parsed = z
      .object({
        type: z.enum(importTypes),
        format: z.enum(["csv", "xlsx"]),
      })
      .strict()
      .safeParse(Object.fromEntries(params))
    if (!parsed.success || params.size !== 2 || !adapterFor(parsed.data.type))
      fail("INVALID_INPUT", 422)
    await database().$transaction(async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      const candidate = subject("ImportBatch", { createdBy: actor.userId })
      if (
        !actor.administrator ||
        !["types", "namespace"].every((field) =>
          actor.ability.can("create", candidate, field)
        )
      )
        fail("FORBIDDEN", 403)
    })
    const { type, format } = parsed.data
    const xlsx = format === "xlsx"
    return new Response(
      xlsx
        ? new Uint8Array(generateImportTemplateXlsx(type))
        : generateImportTemplateCsv(type),
      {
        headers: {
          "Content-Type": xlsx
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${type.toLowerCase()}-template.${format}"`,
          "Cache-Control": "private,no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    )
  })
}
