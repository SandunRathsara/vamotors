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
import { executeCustomer } from "@/lib/server/customers"
import { executeParty } from "@/lib/server/parties"
import { partyCommands, type PartyCommandName } from "@/lib/server/validators"
import {
  customerCommands,
  type CustomerCommandName,
} from "@/lib/server/validators"
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
    const customer = Object.hasOwn(customerCommands, name)
    const party = Object.hasOwn(partyCommands, name)
    if (!customer && !party && !Object.hasOwn(commandInputs, name))
      fail("NOT_FOUND", 404)
    const raw = await boundedJSON(request)
    const directory =
      party &&
      (name !== "archiveParty" ||
        (raw as { input?: { type?: string } })?.input?.type !== "CUSTOMER")
    const result = directory
      ? await executeParty(identity, name as PartyCommandName, raw)
      : customer
        ? await executeCustomer(identity, name as CustomerCommandName, raw)
        : await executeAdmin(identity, name as CommandName, raw)
    const created =
      name === "createUser" ||
      name === "createCustomer" ||
      name === "createDirectoryParty" ||
      (name === "saveRole" && !(raw as { input: { id?: string } }).input.id)
    return noStoreJSON(result, !result.replayed && created ? 201 : 200)
  })
}
