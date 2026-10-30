"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  PartyDTO,
  Visible,
  Page,
} from "@/.planning/implementation/contracts/api"
import { parseMajor, major, minor } from "@/lib/money"
import { rateCommands } from "@/lib/server/validators"
import { abilityFor } from "@/lib/server/permissions"
import { useActor } from "@/components/providers/auth-boundary"
import { rateRequest, useRateCommand } from "./rate-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Sheet = {
  id: string
  revision: 1
  companyId: string
  version: number
  make: string
  model: string
  year: number
  maximum: string
  validFrom: string
  validThrough: string
  cards: {
    id: string
    principal: string
    months: number
    installment: string
  }[]
}
async function activeCompanies() {
  const rows: Visible<PartyDTO>[] = []
  let page = 1,
    result: Page<Visible<PartyDTO>>
  do {
    result = (
      await rateRequest<{ data: Page<Visible<PartyDTO>> }>(
        `/api/v1/queries/parties?type=FINANCE_COMPANY&active=true&pageSize=100&page=${page}`
      )
    ).data
    rows.push(...result.data)
    page++
  } while ((page - 1) * 100 < result.total)
  return { ...result, data: rows }
}
const initial = {
  companyId: "",
  make: "",
  model: "",
  year: "",
  validFrom: "",
  validThrough: "",
  maximum: "",
}
const emptyCard = () => ({ principal: "", months: "", installment: "" })
export function RateSheetsView() {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const queries = useQueryClient()
  const [draft, setDraft] = useState(initial)
  const [cards, setCards] = useState([emptyCard()])
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState("")
  const [saved, setSaved] = useState("")
  const command = useRateCommand("publishRates")
  const companies = useQuery({
    queryKey: ["rate-companies"],
    queryFn: activeCompanies,
    retry: false,
  })
  const sheets = useQuery({
    queryKey: ["rates", filter, page],
    queryFn: () =>
      rateRequest<Page<Visible<Sheet>>>(
        `/api/lease-rate-sheets?page=${page}&pageSize=20${filter ? `&companyId=${encodeURIComponent(filter)}` : ""}`
      ),
    retry: false,
  })
  const owners = companies.data?.data ?? []
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const owner = owners.find((c) => c.id === draft.companyId)
    if (!command.body && (!owner?.id || !owner.revision)) {
      command.setError(
        "Current finance company reference is not readable. Refresh companies; your draft is retained."
      )
      return
    }
    let input
    try {
      input = rateCommands.publishRates.parse({
        ...draft,
        year: Number(draft.year),
        maximum: parseMajor(draft.maximum),
        cards: cards.map((c) => ({
          principal: parseMajor(c.principal),
          months: Number(c.months),
          installment: parseMajor(c.installment),
        })),
      })
    } catch {
      command.setError(
        "Check dates, positive exact amounts, term 1–120, maximum and duplicate principal/term cards. Your values are retained."
      )
      return
    }
    const result = await command.send(input, [
      {
        type: "FinanceCompany",
        id: owner?.id ?? "",
        revision: owner?.revision ?? 0,
      },
    ])
    if (result) {
      setSaved(`Published immutable sheet ${result.result.id}.`)
      await queries.invalidateQueries({ queryKey: ["rates"] })
    }
  }
  const field = (key: keyof typeof initial, label: string, type = "text") => (
    <div className="min-w-0 space-y-2" key={key}>
      <Label htmlFor={`rate-${key}`}>{label}</Label>
      <Input
        id={`rate-${key}`}
        type={type}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        required
        className="min-h-11"
      />
    </div>
  )
  return (
    <section className="min-w-0 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Rate sheets</h1>
        <p className="text-muted-foreground">
          Immutable published versions and exact lender cards. Amounts below are
          major currency units; no rates are approximated.
        </p>
      </header>
      {saved && <p role="status">{saved}</p>}
      {(ability.can("create", "RateSheet") || command.body) && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">Publish rate sheet</h2>
          <fieldset
            disabled={command.pending || !!command.body}
            className="space-y-4"
          >
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="rate-companyId">Finance company</Label>
                <select
                  id="rate-companyId"
                  className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3"
                  value={draft.companyId}
                  onChange={(e) =>
                    setDraft({ ...draft, companyId: e.target.value })
                  }
                  required
                >
                  <option value="">Select active company</option>
                  {owners
                    .filter((c) => c.id && c.revision && c.name)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              {field("make", "Make")}
              {field("model", "Model")}
              {field("year", "Manufacture year", "number")}
              {field("validFrom", "Valid from", "date")}
              {field("validThrough", "Valid through (inclusive)", "date")}
              {field("maximum", "Maximum loan", "text")}
            </div>
            <h3 className="font-semibold">Exact cards</h3>
            {cards.map((card, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-4"
              >
                {(
                  [
                    ["principal", "Principal"],
                    ["months", "Months"],
                    ["installment", "Installment"],
                  ] as const
                ).map(([key, label]) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={`card-${index}-${key}`}>
                      {label} {index + 1}
                    </Label>
                    <Input
                      id={`card-${index}-${key}`}
                      value={card[key]}
                      onChange={(e) =>
                        setCards(
                          cards.map((c, i) =>
                            i === index ? { ...c, [key]: e.target.value } : c
                          )
                        )
                      }
                      required
                      className="min-h-11"
                      inputMode={key === "months" ? "numeric" : "decimal"}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 self-end"
                  disabled={cards.length === 1}
                  onClick={() => setCards(cards.filter((_, i) => i !== index))}
                >
                  Remove card {index + 1}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={cards.length >= 100}
              onClick={() => setCards([...cards, emptyCard()])}
            >
              Add card
            </Button>
          </fieldset>
          {command.error && (
            <p role="alert" tabIndex={-1}>
              {command.error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={command.pending}
            >
              {command.pending
                ? "Publishing…"
                : command.body
                  ? "Retry identical publication"
                  : "Publish rates"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void companies.refetch()}
            >
              Refresh company references
            </Button>
            {command.body && command.definitive && (
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                onClick={async () => {
                  await companies.refetch()
                  command.reconfirm()
                }}
              >
                Confirm new request with refreshed references
              </Button>
            )}
          </div>
        </form>
      )}
      {companies.isError && (
        <p role="alert">
          Finance directory read failed. No fixture companies substituted.{" "}
          <Button onClick={() => void companies.refetch()} variant="outline">
            Retry companies
          </Button>
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="sheet-filter">Filter by company</Label>
        <select
          id="sheet-filter"
          className="min-h-11 w-full rounded-md border bg-background px-3 sm:max-w-sm"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All authorized active companies</option>
          {owners
            .filter((c) => c.id && c.name)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      {sheets.isPending && <p role="status">Loading persisted rate sheets…</p>}
      {sheets.isError && (
        <p role="alert">
          Rate sheet read failed.{" "}
          <Button variant="outline" onClick={() => void sheets.refetch()}>
            Retry sheets
          </Button>
        </p>
      )}
      {sheets.data && !sheets.data.data.length && (
        <p>No authorized published sheets.</p>
      )}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {sheets.data?.data.map((sheet, index) => (
          <article
            className="min-w-0 space-y-3 rounded-lg border p-4"
            key={sheet.id ?? index}
          >
            <h2 className="text-lg font-semibold">
              {owners.find((c) => c.id === sheet.companyId)?.name ??
                "Company unavailable"}{" "}
              · version {sheet.version ?? "restricted"}
            </h2>
            <p>
              {sheet.make} {sheet.model} {sheet.year}
            </p>
            <p>
              Maximum:{" "}
              {sheet.maximum ? major(minor(sheet.maximum)) : "Restricted"}
            </p>
            <p>
              {sheet.validFrom ?? "Restricted"} –{" "}
              {sheet.validThrough ?? "Restricted"} (inclusive)
            </p>
            {sheet.cards ? (
              <ul className="space-y-2">
                {sheet.cards.map((c) => (
                  <li key={c.id} className="rounded bg-muted p-2">
                    {major(minor(c.principal!))} · {c.months} months ·
                    installment {major(minor(c.installment!))}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Cards restricted</p>
            )}
          </article>
        ))}
      </div>
      {sheets.data && (
        <nav
          aria-label="Rate sheet pages"
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} · {sheets.data.total} sheets
          </span>
          <Button
            variant="outline"
            disabled={page * 20 >= sheets.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </section>
  )
}
