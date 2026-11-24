import { authenticate } from "@/lib/server/actor"
import { executeAdmin } from "@/lib/server/admin"
import { executeRepair } from "@/lib/server/repairs"
import { executeExpiry } from "@/lib/server/reservation-expiry"
import { executeCommitment } from "@/lib/server/reservation-sales"
import { commitmentInputs, type CommitmentCommand } from "@/lib/server/validators"
import { executeSale } from "@/lib/server/sales"
import { issueInvoice } from "@/lib/server/invoices"
import {
  repairInputs,
  saleInputs,
  type RepairCommand,
  type SaleCommand,
} from "@/lib/server/validators"
import { commandInputs, type CommandName } from "@/lib/server/validators"
import {
  endpoint,
  sameOrigin,
  boundedJSON,
  noStoreJSON,
} from "@/lib/server/http"
import { fail } from "@/lib/server/errors"
import { executeCustomer } from "@/lib/server/customers"
import { executeApproval } from "@/lib/server/approvals"
import { executeNotification } from "@/lib/server/notifications"
import {
  approvalInputs,
  notificationInputs,
  type ApprovalCommand,
  type NotificationCommand,
} from "@/lib/server/validators"
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
import { executeBrokerage } from "@/lib/server/brokerage"
import { brokerageInputs, type BrokerageCommandName } from "@/lib/server/validators"
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
    if (name === "issueInvoice") {
      const result = await issueInvoice(identity, await boundedJSON(request))
      return noStoreJSON(result, result.status === "DOCUMENT_PENDING" ? 202 : 200)
    }
    if (name === "runExpiry") return noStoreJSON(await executeExpiry(identity, await boundedJSON(request)))
    if (Object.hasOwn(commitmentInputs, name))
      return noStoreJSON(await executeCommitment(identity, name as CommitmentCommand, await boundedJSON(request)))
    const customer = Object.hasOwn(customerCommands, name)
    const party = Object.hasOwn(partyCommands, name)
    const rates = Object.hasOwn(rateCommands, name)
    const brokerage =
      Object.hasOwn(brokerageInputs, name) || name === "dispatchBatch"
    if (
      name !== "updateSettings" &&
      name !== "recordPurchase" &&
      !Object.hasOwn(approvalInputs, name) &&
      !Object.hasOwn(notificationInputs, name) &&
      !Object.hasOwn(stockInputs, name) &&
      !Object.hasOwn(cycleMoneyInputs, name) &&
      !Object.hasOwn(cycleEditInputs, name) &&
      !Object.hasOwn(repairInputs, name) &&
      !Object.hasOwn(saleInputs, name) &&
      !customer &&
      !party &&
      !rates &&
      !brokerage &&
      !Object.hasOwn(attachmentCommands, name) &&
      !Object.hasOwn(commandInputs, name)
    )
      fail("NOT_FOUND", 404)
    const raw = await boundedJSON(request)
    const brokerageReversal =
      name === "reversePayment" &&
      ["FACILITY", "BROKERAGE_FEE"].includes(
        (raw as { input?: { sourceType?: string } })?.input?.sourceType ?? ""
      )
    const directory =
      party &&
      (name !== "archiveParty" ||
        (raw as { input?: { type?: string } })?.input?.type !== "CUSTOMER")
    const result =
      brokerageReversal || brokerage
        ? await executeBrokerage(
            identity,
            name as BrokerageCommandName | "dispatchBatch" | "reversePayment",
            raw
          )
        : Object.hasOwn(repairInputs, name) ||
      (name === "reversePayment" &&
        (raw as { input?: { sourceType?: string } })?.input?.sourceType ===
          "REPAIR")
        ? await executeRepair(
            identity,
            name as RepairCommand | "reversePayment",
            raw
          )
        : Object.hasOwn(saleInputs, name)
          ? await executeSale(identity, name as SaleCommand, raw)
          : Object.hasOwn(approvalInputs, name)
            ? await executeApproval(identity, name as ApprovalCommand, raw)
          : Object.hasOwn(notificationInputs, name)
            ? await executeNotification(
                identity,
                name as NotificationCommand,
                raw
              )
            : name === "stageImport"
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
                            ? await executeStock(
                                identity,
                                name as StockCommand,
                                raw
                              )
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
    if (result.status === "PENDING_APPROVAL") return noStoreJSON(result, 202)
    const created =
      name === "stageImport" ||
      name === "dispatchBatch" ||
      name === "openBrokerage" ||
      name === "createUser" ||
      name === "recordPurchase" ||
      name === "addCost" ||
      name === "sendRepair" ||
      name === "completeImmediate" ||
      name === "intakeTradeIn" ||
      name === "createCustomer" ||
      name === "createDirectoryParty" ||
      name === "createFinanceCompany" ||
      rates ||
      (name === "saveRole" && !(raw as { input: { id?: string } }).input.id)
    return noStoreJSON(result, !result.replayed && created ? 201 : 200)
  })
}
