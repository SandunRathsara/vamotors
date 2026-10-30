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
import { executeSettings } from "@/lib/server/settings"
import {
  recordPurchase,
  executeStock,
  executeCycleMoney,
  executeCycleEdit,
} from "@/lib/server/purchases"
import {
  cycleMoneyInputs,
  type CycleMoneyCommand,
  cycleEditInputs,
  type CycleEditCommand,
} from "@/lib/server/validators"
import { stockInputs, type StockCommand } from "@/lib/server/validators"
import { executeRates } from "@/lib/server/rates"
import { executeStageImport } from "@/lib/server/import-staging"
import { initUpload, completeUpload } from "@/lib/server/attachments"
import { attachmentCommands } from "@/lib/server/validators"
import { rateCommands, type RateCommandName } from "@/lib/server/validators"
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
    const rates = Object.hasOwn(rateCommands, name)
    if (
      name !== "updateSettings" &&
      name !== "recordPurchase" &&
      !Object.hasOwn(stockInputs, name) &&
      !Object.hasOwn(cycleMoneyInputs, name) &&
      !Object.hasOwn(cycleEditInputs, name) &&
      !customer &&
      !party &&
      !rates &&
      !Object.hasOwn(attachmentCommands, name) &&
      !Object.hasOwn(commandInputs, name)
    )
      fail("NOT_FOUND", 404)
    const raw = await boundedJSON(request)
    const directory =
      party &&
      (name !== "archiveParty" ||
        (raw as { input?: { type?: string } })?.input?.type !== "CUSTOMER")
    const result =
      name === "stageImport"
        ? await executeStageImport(identity, raw)
        : name === "initUpload"
          ? await initUpload(identity, raw)
          : name === "completeUpload"
            ? await completeUpload(identity, raw)
            : rates
              ? await executeRates(identity, name as RateCommandName, raw)
              : name === "recordPurchase"
                ? await recordPurchase(identity, raw)
                : Object.hasOwn(cycleEditInputs, name)
                  ? await executeCycleEdit(
                      identity,
                      name as CycleEditCommand,
                      raw
                    )
                  : Object.hasOwn(cycleMoneyInputs, name)
                    ? await executeCycleMoney(
                        identity,
                        name as CycleMoneyCommand,
                        raw
                      )
                    : Object.hasOwn(stockInputs, name)
                      ? await executeStock(identity, name as StockCommand, raw)
                      : name === "updateSettings"
                        ? await executeSettings(identity, raw)
                        : directory
                          ? await executeParty(
                              identity,
                              name as PartyCommandName,
                              raw
                            )
                          : customer
                            ? await executeCustomer(
                                identity,
                                name as CustomerCommandName,
                                raw
                              )
                            : await executeAdmin(
                                identity,
                                name as CommandName,
                                raw
                              )
    if (result.status === "UPLOAD_READY") return noStoreJSON(result, 201)
    const created =
      name === "stageImport" ||
      name === "createUser" ||
      name === "recordPurchase" ||
      name === "addCost" ||
      name === "createCustomer" ||
      name === "createDirectoryParty" ||
      name === "createFinanceCompany" ||
      rates ||
      (name === "saveRole" && !(raw as { input: { id?: string } }).input.id)
    return noStoreJSON(result, !result.replayed && created ? 201 : 200)
  })
}
