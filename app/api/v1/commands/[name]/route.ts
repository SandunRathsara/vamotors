import { authenticate } from "@/lib/server/actor"
import { executeAdmin } from "@/lib/server/admin"
import { commandInputs, type CommandName } from "@/lib/server/validators"
import {
  endpoint,
  sameOrigin,
  boundedJSON,
  noStoreJSON,
} from "@/lib/server/http"
import { fail } from "@/lib/server/errors"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(
  request: Request,
  context: { params: Promise<{ name: string }> }
) {
  return endpoint(async () => {
    const identity = await authenticate(request.headers)
    sameOrigin(request)
    const { name } = await context.params
    if (!Object.hasOwn(commandInputs, name)) fail("NOT_FOUND", 404)
    const raw = await boundedJSON(request)
    const result = await executeAdmin(identity, name as CommandName, raw)
    const created =
      name === "createUser" ||
      (name === "saveRole" && !(raw as { input: { id?: string } }).input.id)
    return noStoreJSON(result, !result.replayed && created ? 201 : 200)
  })
}
