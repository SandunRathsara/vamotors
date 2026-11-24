"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import type {
  CompareResult,
  LoanMaximumDTO,
  PartyDTO,
  QuoteDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { major, minor, parseMajor } from "@/lib/money"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { maximaInput, compareInput } from "@/lib/server/validators"
import { postRead, rateRequest, useRateCommand } from "./rate-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Selection = {
  option: CompareResult
  cardId: string
  vehicle: QuoteDTO["vehicle"]
}
const money = (value: string | null | undefined) =>
  value == null ? "Unavailable" : major(minor(value))
export function LeaseComparisonView({
  quoteId: initialQuoteId = "",
}: {
  quoteId?: string
}) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const [draft, setDraft] = useState({
    make: "",
    model: "",
    year: "",
    description: "External vehicle — no inventory acquisition",
    asOf: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    principal: "",
    mode: "months",
    months: "",
    installment: "",
  })
  const [maxima, setMaxima] = useState<LoanMaximumDTO[] | null>(null)
  const [options, setOptions] = useState<CompareResult[] | null>(null)
  const [comparedVehicle, setComparedVehicle] = useState<
    QuoteDTO["vehicle"] | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<Selection | null>(null)
  const [fees, setFees] = useState({ documents: "0", government: "0" })
  const [quoteId, setQuoteId] = useState(initialQuoteId)
  const command = useRateCommand("selectQuote")
  const [readRevision, setReadRevision] = useState(actor.authzRevision)
  const policy = useQuery({
    queryKey: ["quote-company", selected?.option.companyId],
    queryFn: () =>
      rateRequest<{ data: Visible<PartyDTO> }>(
        `/api/v1/queries/party?type=FINANCE_COMPANY&id=${selected!.option.companyId}`
      ),
    enabled: !!selected,
    retry: false,
  })
  const settings = useQuery({
    queryKey: ["quote-settings"],
    queryFn: () =>
      rateRequest<{ data: { id?: string; revision?: number } }>(
        "/api/v1/queries/settings"
      ),
    enabled: !!selected,
    retry: false,
  })
  const quote = useQuery({
    queryKey: ["quotes", quoteId],
    queryFn: () =>
      rateRequest<{ data: Visible<QuoteDTO> }>(
        `/api/v1/queries/quote?id=${encodeURIComponent(quoteId)}`
      ),
    enabled: !!quoteId,
    retry: false,
  })
  async function discover(compare: boolean) {
    setError("")
    setLoading(true)
    try {
      const vehicle = {
        make: draft.make,
        model: draft.model,
        year: Number(draft.year),
        description: draft.description,
      }
      const maximumInput = maximaInput.parse({
        vehicle: {
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
        },
        asOf: draft.asOf,
      })
      const request = compare
        ? compareInput.parse({
            vehicle,
            asOf: draft.asOf,
            principal: parseMajor(draft.principal),
            ...(draft.mode === "months"
              ? { months: Number(draft.months) }
              : { installment: parseMajor(draft.installment) }),
          })
        : null
      const max = await postRead<LoanMaximumDTO[]>("loanMaxima", maximumInput)
      setReadRevision(actor.authzRevision)
      setMaxima(max.data)
      if (request) {
        const result = await postRead<CompareResult[]>("compare", request)
        setOptions(result.data)
        setComparedVehicle(vehicle)
      } else {
        setOptions(null)
        setComparedVehicle(null)
      }
      if (!command.body) setSelected(null)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message.includes("[") ? "INVALID_INPUT" : cause.message}. Values retained; no approximate result has been substituted.`
          : "Read failed. Values retained."
      )
    } finally {
      setLoading(false)
    }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !selected.option.sheetId) return
    const current = settings.data?.data
    if (!command.body && (!current?.id || !current.revision)) {
      command.setError(
        "Settings reference unavailable. Refresh references; values retained."
      )
      return
    }
    let charges
    try {
      charges = [
        { category: "DOCUMENT_FEES", amount: parseMajor(fees.documents) },
        { category: "GOVERNMENT_FEES", amount: parseMajor(fees.government) },
      ]
    } catch {
      command.setError(
        "Charges must be nonnegative exact amounts with at most two decimal places."
      )
      return
    }
    const result = await command.send(
      {
        sheetId: selected.option.sheetId,
        cardId: selected.cardId,
        vehicle: selected.vehicle,
        charges,
      },
      [
        {
          type: "RateSheet",
          id: selected.option.sheetId,
          revision: selected.option.sheetRevision,
        },
        {
          type: "FinanceCompany",
          id: selected.option.companyId,
          revision: selected.option.companyRevision,
        },
        {
          type: "Settings",
          id: current?.id ?? "",
          revision: current?.revision ?? 0,
        },
      ]
    )
    if (result) setQuoteId(result.result.id)
  }
  const field = (key: keyof typeof draft, label: string, type = "text") => (
    <div className="min-w-0 space-y-2" key={key}>
      <Label htmlFor={`compare-${key}`}>{label}</Label>
      <Input
        id={`compare-${key}`}
        type={type}
        className="min-h-11"
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  )
  const pick = (option: CompareResult, cardId: string) => {
    if (!command.body && comparedVehicle) {
      setSelected({ option, cardId, vehicle: comparedVehicle })
      setQuoteId("")
    }
  }
  return (
    <section className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Lease comparison</h1>
        <p className="text-muted-foreground">
          External vehicle only. Check maxima before entering a principal.
          Compare exact cards by months or installment; unsupported values are
          never approximated.
        </p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void discover(true)
        }}
        className="space-y-4 rounded-lg border p-4"
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {field("make", "Make")}
          {field("model", "Model")}
          {field("year", "Manufacture year", "number")}
          {field("asOf", "Rate date", "date")}
          {field("description", "Vehicle description")}
          {field("principal", "Requested principal")}
          <div className="space-y-2">
            <Label htmlFor="compare-mode">Known term</Label>
            <select
              id="compare-mode"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
            >
              <option value="months">Period (months)</option>
              <option value="installment">Installment amount</option>
            </select>
          </div>
          {draft.mode === "months"
            ? field("months", "Period (months)", "number")
            : field("installment", "Installment amount")}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => void discover(false)}
          >
            Check loan maxima
          </Button>
          <Button className="min-h-11" disabled={loading}>
            {loading ? "Reading rates…" : "Compare exact cards"}
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
      {maxima && readRevision === actor.authzRevision && (
        <section className="space-y-3" aria-label="Company loan maxima">
          <h2 className="text-xl font-semibold">Loan maxima</h2>
          {!maxima.length && (
            <p>No authorized active companies in this scope.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {maxima.map((row) => (
              <article
                key={row.companyId}
                className="space-y-2 rounded-lg border p-4"
              >
                <h3 className="font-semibold">{row.companyName}</h3>
                <p>
                  {row.status === "APPLICABLE"
                    ? `Maximum ${money(row.maximum)} · ${row.validFrom} – ${row.validThrough}`
                    : `${row.reason}: no applicable maximum`}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      {options && readRevision === actor.authzRevision && (
        <section className="space-y-3" aria-label="Exact comparison results">
          <h2 className="text-xl font-semibold">Exact comparison</h2>
          <p className="text-sm text-muted-foreground">
            Results belong to the last submitted vehicle and rate date.
            Selection rechecks current validity.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {options.map((option) => (
              <article
                key={option.companyId}
                className="min-w-0 space-y-3 rounded-lg border p-4"
              >
                <h3 className="font-semibold">
                  {maxima?.find((c) => c.companyId === option.companyId)
                    ?.companyName ?? "Authorized company"}
                </h3>
                <p>Maximum {money(option.maximum)}</p>
                {option.status === "SUPPORTED" ? (
                  <>
                    <p>Principal {money(option.principal)}</p>
                    <p>
                      {option.months} months · installment{" "}
                      {money(option.installment)}
                    </p>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={
                        !!command.body || !ability.can("create", "Quote")
                      }
                      onClick={() => pick(option, option.cardId)}
                    >
                      Select exact option
                    </Button>
                  </>
                ) : (
                  <>
                    <p role="status">
                      {option.reason === "AMBIGUOUS"
                        ? "AMBIGUOUS — select an explicit card; no term was guessed."
                        : `${option.reason} — unsupported combination`}
                    </p>
                    {option.choices?.map((card) => (
                      <Button
                        key={card.cardId}
                        variant="outline"
                        className="min-h-11 w-full"
                        disabled={
                          !!command.body || !ability.can("create", "Quote")
                        }
                        onClick={() => pick(option, card.cardId)}
                      >
                        Select {card.months} months · {money(card.installment)}
                      </Button>
                    ))}
                  </>
                )}
                <p className="text-sm text-muted-foreground">
                  {option.validThrough
                    ? `Valid through ${option.validThrough}`
                    : "No applicable sheet"}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
      {selected && (
        <form onSubmit={save} className="space-y-4 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">
            Save quote snapshot and charges
          </h2>
          <p>
            The selected company’s persisted policy is shown below. Quote
            snapshots do not change when future policy changes.
          </p>
          {policy.isPending && <p role="status">Reading company policy…</p>}
          {policy.isError && (
            <p role="alert">
              Company policy read failed; no default substituted.
            </p>
          )}
          {policy.data && (
            <dl className="space-y-2">
              <div>
                <dt>Processing path</dt>
                <dd>{policy.data.data.policy?.path ?? "Restricted"}</dd>
              </div>
              <div>
                <dt>Processing fee</dt>
                <dd>{money(policy.data.data.policy?.processingFee)}</dd>
              </div>
              <div>
                <dt>Commission policy</dt>
                <dd>
                  {policy.data.data.policy?.commission
                    ? JSON.stringify(policy.data.data.policy.commission)
                    : "Restricted"}
                </dd>
              </div>
            </dl>
          )}
          <fieldset
            disabled={command.pending || !!command.body}
            className="grid gap-4 sm:grid-cols-2"
          >
            {(
              [
                ["documents", "Document fees"],
                ["government", "Government fees"],
              ] as const
            ).map(([key, label]) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`quote-${key}`}>{label}</Label>
                <Input
                  id={`quote-${key}`}
                  className="min-h-11"
                  inputMode="decimal"
                  value={fees[key]}
                  onChange={(e) => setFees({ ...fees, [key]: e.target.value })}
                />
              </div>
            ))}
          </fieldset>
          {command.error && <p role="alert">{command.error}</p>}
          {settings.isError && (
            <p role="alert">
              Settings reference read failed. Your selection and fees are
              retained.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={
                command.pending ||
                (!command.body &&
                  (!settings.data?.data.id || !settings.data.data.revision))
              }
            >
              {command.pending
                ? "Saving…"
                : command.body
                  ? "Retry identical quote request"
                  : "Save quote snapshot"}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              variant="outline"
              onClick={() => {
                void settings.refetch()
                void policy.refetch()
              }}
            >
              Refresh policy and settings
            </Button>
            {command.body && command.definitive && (
              <Button
                type="button"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                variant="outline"
                onClick={async () => {
                  await settings.refetch()
                  command.reconfirm()
                  setSelected(null)
                  setError(
                    "Recompare to select fresh company/sheet references; fees retained."
                  )
                }}
              >
                Confirm new intent (recompare required)
              </Button>
            )}
          </div>
        </form>
      )}
      {quoteId && (
        <article className="space-y-3 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Saved quote handoff</h2>
          {quote.isPending && (
            <p role="status">Reading authorized saved snapshot…</p>
          )}
          {quote.isError && (
            <p role="alert">
              Saved quote is not currently readable. Creation does not grant
              read access.{" "}
              <Button variant="outline" onClick={() => void quote.refetch()}>
                Retry quote read
              </Button>
            </p>
          )}
          {quote.data && (
            <>
              <p>Quote {quote.data.data.id ?? "Restricted"}</p>
              <p>
                Principal {money(quote.data.data.principal)} ·{" "}
                {quote.data.data.months ?? "Restricted"} months · installment{" "}
                {money(quote.data.data.installment)}
              </p>
              <p>Maximum {money(quote.data.data.maximum)}</p>
              <p>
                Expiry: {quote.data.data.expiresAt ?? "Restricted"}
                {quote.data.data.expiresAt &&
                new Date(quote.data.data.expiresAt) <= new Date()
                  ? " — EXPIRED, select a new quote"
                  : ""}
              </p>
              <p>
                Path: {quote.data.data.policy?.path ?? "Restricted"} ·
                processing fee {money(quote.data.data.policy?.processingFee)}
              </p>
              <p>
                Charges:{" "}
                {quote.data.data.charges
                  ?.map((c) => `${c.category}: ${money(c.amount)}`)
                  .join("; ") ?? "Restricted"}
              </p>
              <Link
                className="inline-block break-all underline"
                href={`/lease-comparison?quote=${encodeURIComponent(quoteId)}`}
              >
                Permanent authorized quote link
              </Link>
            </>
          )}
          {quote.data?.data.id && ability.can("create", "BrokerageDeal") && (
            <Button asChild>
              <Link href={`/lease-deals?quote=${encodeURIComponent(quoteId)}`}>
                Open brokerage intake
              </Link>
            </Button>
          )}
        </article>
      )}
    </section>
  )
}
