"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { subject } from "@casl/ability"
import type {
  Applied,
  Dependency,
  DownloadDTO,
  ImportBatchSummaryDTO,
  ImportPreview,
  ImportSourceUploadDTO,
  UploadReady,
} from "@/.planning/implementation/contracts/api"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { privateRequest, RequestError } from "@/lib/security-client"
import { formatCurrency } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Batch = Partial<ImportBatchSummaryDTO> & {
  uploads?: Partial<ImportSourceUploadDTO>[]
  redactedFields?: string[]
  importedRecords?: {
    type: string
    row: number
    sourceKey: string
    href: string
  }[]
}
type Action = {
  name:
    | "stageImport"
    | "initUpload"
    | "completeUpload"
    | "previewImport"
    | "confirmImport"
  body: string
}
const mime = (file: File) =>
  /\.csv$/i.test(file.name)
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
async function fileHash(file: File) {
  if (!/\.(csv|xlsx)$/i.test(file.name) || file.size < 1 || file.size > 5242880)
    throw new Error("Choose CSV/XLSX bytes between 1 byte and 5 MiB.")
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
    ),
    (b) => b.toString(16).padStart(2, "0")
  ).join("")
}
export function ImportStaging({
  id,
  administrator,
  supportedTypes,
}: {
  id?: string
  administrator: boolean
  supportedTypes: readonly string[]
}) {
  const { actor } = useActor(),
    ability = abilityFor(actor.presentationGrants, actor.user.id)
  const params = useSearchParams(),
    router = useRouter(),
    queries = useQueryClient()
  const [namespace, setNamespace] = useState("")
  const [types, setTypes] = useState<string[]>(["SUPPLIERS"])
  const [file, setFile] = useState<File | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [pending, setPending] = useState(false),
    [stale, setStale] = useState(false)
  const [error, setError] = useState(""),
    [message, setMessage] = useState("")
  const query = useQuery({
    queryKey: ["imports", id ?? "list", params.toString()],
    retry: false,
    queryFn: async () =>
      id
        ? privateRequest<{ data: Batch }>(
            `/api/v1/queries/importBatchFiles?id=${id}`
          )
        : privateRequest<{
            data: {
              data: Batch[]
              total: number
              page: number
              pageSize: number
            }
          }>(`/api/v1/queries/importBatches?${params}`),
  })
  const row = id ? (query.data?.data as Batch | undefined) : undefined
  const list = !id
    ? (query.data?.data as
        | { data: Batch[]; total: number; page: number; pageSize: number }
        | undefined)
    : undefined
  const candidate = subject("ImportBatch", { createdBy: actor.user.id })
  const canStage =
    administrator &&
    ["types", "namespace"].every((f) => ability.can("create", candidate, f))
  const canUpload =
    row?.id &&
    row.revision &&
    row.state !== "COMMITTED" &&
    row.uploads !== undefined &&
    ability.can("read", "ImportBatch", "uploads") &&
    ability.can("update", "ImportBatch", "uploads") &&
    ability.can("create", "Document")
  const batchRef =
    row?.id && row.revision
      ? [{ type: "ImportBatch" as const, id: row.id, revision: row.revision }]
      : []
  const canValidate =
    canStage &&
    canUpload &&
    row?.types?.every((type) => supportedTypes.includes(type))
  const finalUploads =
    row?.uploads?.filter(
      (upload) => upload.state === "FINAL" && upload.attachmentId
    ) ?? []
  const sourceSelection =
    row?.types?.map((type) => ({ type, attachmentId: selected[type] })) ?? []
  const makeAction = (
    name: Action["name"],
    input: unknown,
    expected: Dependency[] = []
  ): Action => ({
    name,
    body: JSON.stringify({
      schemaVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      expected,
      input,
    }),
  })
  async function refresh() {
    await queries.invalidateQueries({ queryKey: ["imports"] })
  }
  async function send(uploadId: string, selected: File) {
    const response = await fetch(`/api/v1/uploads/${uploadId}`, {
      method: "PUT",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": mime(selected),
        "X-Content-SHA256": await fileHash(selected),
      },
      body: selected,
    })
    if (!response.ok) {
      if ([401, 403].includes(response.status))
        window.dispatchEvent(new Event("access-lost"))
      const result = await response.json().catch(() => null)
      throw new RequestError(
        result?.error?.code ?? "UPLOAD_FAILED",
        response.status
      )
    }
    setMessage(
      "Source bytes staged privately. Finalize them explicitly below; no business rows have been imported."
    )
  }
  async function run(next: Action) {
    if (pending || stale) return
    setPending(true)
    setAction(next)
    setError("")
    setMessage("")
    try {
      const result = await privateRequest<
        Applied | UploadReady | ImportPreview
      >(`/api/v1/commands/${next.name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: next.body,
      })
      if (result.status === "UPLOAD_READY") {
        if (!file)
          throw new Error(
            "Reselect the exact declared file, then retry unchanged."
          )
        await send(result.uploadId, file)
      } else if (result.status === "IMPORT_PREVIEW") {
        setPreview(result)
        setMessage(
          result.valid
            ? "Validation passed. Review the totals before confirming."
            : "Fix the listed errors and validate the replacement files."
        )
      } else if (next.name === "confirmImport") {
        setPreview(null)
        setMessage("Historical import committed.")
      } else if (next.name === "stageImport") {
        setAction(null)
        router.push(`/imports/${result.result.id}`)
      } else {
        setPreview(null)
        setMessage(
          "Private source file finalized. Select it for validation below."
        )
      }
      setAction(null)
      await refresh()
    } catch (cause) {
      const code =
        cause instanceof RequestError
          ? cause.code
          : cause instanceof Error
            ? cause.message
            : "NETWORK_ERROR"
      setStale(
        [
          "STALE_REVISION",
          "IMPORT_STALE",
          "REVISION_REQUIRED",
          "INVALID_STATE",
          "UPLOAD_EXPIRED",
          "IDEMPOTENCY_MISMATCH",
        ].includes(code)
      )
      setError(
        `${code}${cause instanceof RequestError && cause.message !== code ? ` — ${cause.message}` : ""}. Your inputs and exact request are retained. A network error may hide a committed result; retry the identical request first. Reload/reconfirm after stale or expired state; expired uploads need a new upload.`
      )
    } finally {
      setPending(false)
    }
  }
  async function upload() {
    if (!row?.id || !row.revision || !file) return
    try {
      const sha256 = await fileHash(file)
      await run(
        makeAction(
          "initUpload",
          {
            target: { type: "IMPORT_BATCH", id: row.id },
            purpose: "IMPORT_SOURCE",
            filename: file.name,
            contentType: mime(file),
            size: file.size,
            sha256,
          },
          [{ type: "ImportBatch", id: row.id, revision: row.revision }]
        )
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File unavailable")
    }
  }
  async function download(attachmentId: string) {
    try {
      const { data } = await privateRequest<{ data: DownloadDTO }>(
        `/api/v1/queries/download?attachmentId=${attachmentId}`
      )
      window.location.assign(data.url)
    } catch (cause) {
      setError(
        cause instanceof RequestError ? cause.code : "Download unavailable"
      )
    }
  }
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {id ? "Historical import batch" : "Historical imports"}
        </h1>
        {id && (
          <Link
            prefetch={false}
            href="/imports"
            className="inline-flex min-h-11 items-center underline"
          >
            Back to historical imports
          </Link>
        )}
      </header>
      <p className="text-sm text-muted-foreground">
        Upload one CSV or Excel file per record type and review validation
        before committing. A batch accepts up to 24 rows and 1 MiB of source
        files.
      </p>
      {error && (
        <p role="alert" className="break-words">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {action && (
        <div className="flex flex-wrap gap-3">
          {!stale && (
            <Button disabled={pending} onClick={() => void run(action)}>
              Retry identical request
            </Button>
          )}
          <Button
            variant="outline"
            disabled={pending}
            onClick={async () => {
              const result = await query.refetch()
              if (result.isError) {
                setError("Reload failed. Request and inputs retained.")
                return
              }
              setAction(null)
              setPreview(null)
              setStale(false)
              setError("")
              setMessage(
                "Current state reloaded. Check it and explicitly reconfirm; an expired or stale intent requires a new upload."
              )
            }}
          >
            Reload state and reconfirm
          </Button>
        </div>
      )}
      {!id && canStage && (
        <form
          className="space-y-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!action)
              void run(
                makeAction("stageImport", {
                  namespace: namespace.trim(),
                  types,
                })
              )
          }}
        >
          <h2 className="font-semibold">Stage source metadata</h2>
          <Label htmlFor="import-namespace">Namespace</Label>
          <Input
            id="import-namespace"
            required
            maxLength={200}
            value={namespace}
            disabled={pending || !!action}
            onChange={(event) => setNamespace(event.target.value)}
            className="min-h-11 text-base"
          />
          <fieldset disabled={pending || !!action} className="space-y-2">
            <legend className="text-sm font-medium">
              Declared import types
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {supportedTypes.map((type) => (
                <label key={type} className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={(event) =>
                      setTypes(
                        event.target.checked
                          ? [...types, type]
                          : types.filter((t) => t !== type)
                      )
                    }
                  />
                  {type.replaceAll("_", " ").toLowerCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <ul className="space-y-2 text-sm">
            {types.map((type) => (
              <li key={type} className="flex flex-wrap items-center gap-x-3">
                <span className="capitalize">
                  {type.replaceAll("_", " ").toLowerCase()} template
                </span>
                {["csv", "xlsx"].map((format) => (
                  <a
                    key={format}
                    className="inline-flex min-h-11 items-center underline"
                    href={`/api/v1/import-template?type=${type}&format=${format}`}
                  >
                    Download {format === "xlsx" ? "Excel" : "CSV"}
                  </a>
                ))}
              </li>
            ))}
          </ul>
          <Button disabled={pending || !!action || !types.length} type="submit">
            Create STAGED batch
          </Button>
        </form>
      )}
      {!id && (
        <form
          key={params.toString()}
          className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            const values = new FormData(event.currentTarget),
              next = new URLSearchParams()
            for (const [key, value] of values)
              if (String(value)) next.set(key, String(value))
            next.set("page", "1")
            next.set("pageSize", "20")
            router.push(`/imports?${next}`)
          }}
        >
          {[
            ["q", "Search namespace"],
            ["namespace", "Exact namespace"],
            ["from", "Created from (Colombo)"],
            ["through", "Created through (Colombo)"],
          ].map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`import-${key}`}>{label}</Label>
              <Input
                id={`import-${key}`}
                name={key}
                type={["from", "through"].includes(key) ? "date" : "text"}
                defaultValue={params.get(key) ?? ""}
                maxLength={200}
                className="min-h-11 text-base"
              />
            </div>
          ))}
          <div className="space-y-2">
            <Label htmlFor="import-state">Batch state</Label>
            <select
              id="import-state"
              name="state"
              className="min-h-11 w-full rounded border bg-background px-3"
              defaultValue={params.get("state") ?? ""}
            >
              <option value="">All authorized states</option>
              {["STAGED", "VALIDATED", "COMMITTED", "FAILED"].map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </div>
          <Button type="submit" className="self-end">
            Search batches
          </Button>
        </form>
      )}
      {query.isPending && <p role="status">Loading current staging records…</p>}
      {query.isError && (
        <p role="alert">
          Staging data unavailable:{" "}
          {query.error instanceof RequestError
            ? query.error.code
            : "Request failed"}
        </p>
      )}
      {list && (
        <>
          <p role="status">
            {list.total} authorized batch{list.total === 1 ? "" : "es"}
          </p>
          <ul className="divide-y rounded-lg border">
            {list.data.map((batch, index) => (
              <li
                key={batch.id ?? index}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0 break-words">
                  <p className="font-medium">
                    {batch.namespace ?? "Namespace unavailable"}
                  </p>
                  <p className="text-sm">
                    {batch.state ?? "State unavailable"} ·{" "}
                    {batch.createdAt ?? "Date unavailable"}
                  </p>
                </div>
                {batch.id && (
                  <Link
                    prefetch={false}
                    href={`/imports/${batch.id}`}
                    className="inline-flex min-h-11 items-center underline"
                  >
                    View staged files
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {!list.data.length && (
            <p>No authorized staged batches match these filters.</p>
          )}
          <div className="flex items-center gap-3">
            {[-1, 1].map((direction) => (
              <Button
                key={direction}
                variant="outline"
                disabled={
                  direction < 0
                    ? list.page <= 1
                    : list.page * list.pageSize >= list.total
                }
                onClick={() => {
                  const next = new URLSearchParams(params)
                  next.set("page", String(list.page + direction))
                  router.push(`/imports?${next}`)
                }}
              >
                {direction < 0 ? "Previous" : "Next"}
              </Button>
            ))}
            <span>Page {list.page}</span>
          </div>
        </>
      )}
      {row && (
        <>
          <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            {(
              ["namespace", "state", "revision", "createdAt", "types"] as const
            ).map((key) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">{key}</dt>
                <dd className="break-words">
                  {Array.isArray(row[key])
                    ? row[key].join(", ")
                    : (row[key] ?? "Unavailable")}
                </dd>
              </div>
            ))}
          </dl>
          {canUpload && (
            <div className="space-y-3 rounded-lg border p-4">
              <Label htmlFor="import-file">
                CSV or XLSX source file (maximum 5 MiB)
              </Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx"
                disabled={pending || !!action}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="min-h-11 text-base"
              />
              <Button
                disabled={!file || pending || !!action}
                onClick={() => void upload()}
              >
                Upload source bytes with new intent
              </Button>
            </div>
          )}
          {canValidate && (
            <section className="space-y-4 rounded-lg border p-4">
              <h2 className="font-semibold">Validate source files</h2>
              {sourceSelection.map(({ type, attachmentId }) => (
                <div key={type} className="space-y-2">
                  <Label htmlFor={`import-source-${type}`}>
                    {type.replaceAll("_", " ").toLowerCase()} source
                  </Label>
                  <select
                    id={`import-source-${type}`}
                    value={attachmentId ?? ""}
                    disabled={pending || !!action}
                    className="min-h-11 w-full rounded border bg-background px-3"
                    onChange={(event) => {
                      setSelected({ ...selected, [type]: event.target.value })
                      setPreview(null)
                    }}
                  >
                    <option value="">Choose a finalized file</option>
                    {finalUploads.map((upload) => (
                      <option
                        key={upload.attachmentId}
                        value={upload.attachmentId ?? ""}
                      >
                        {upload.filename} ({upload.attachmentId?.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <Button
                disabled={
                  pending ||
                  !!action ||
                  !sourceSelection.every((source) => source.attachmentId)
                }
                onClick={() =>
                  void run(
                    makeAction(
                      "previewImport",
                      {
                        batchId: row.id,
                        namespace: row.namespace,
                        sources: sourceSelection,
                        templateVersion: 1,
                      },
                      batchRef
                    )
                  )
                }
              >
                Validate and preview
              </Button>
              {preview && (
                <div className="space-y-3">
                  <h3 className="font-semibold">
                    {preview.valid ? "Validated preview" : "Validation errors"}
                  </h3>
                  {preview.errors.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5" role="alert">
                      {preview.errors.map((error, index) => (
                        <li key={index} className="break-words">
                          {finalUploads.find(
                            (upload) =>
                              upload.attachmentId === error.attachmentId
                          )?.filename ?? "Batch"}
                          , row {error.rowNumber}, {error.field} —{" "}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {preview.valid && (
                    <>
                      <dl className="grid gap-2 sm:grid-cols-3">
                        {(
                          [
                            ["Rows", preview.controlTotals.rows],
                            ["Purchases", preview.controlTotals.purchase],
                            [
                              "Repair and additional costs",
                              preview.controlTotals.cost,
                            ],
                            [
                              "Sale consideration",
                              preview.controlTotals.consideration,
                            ],
                            ["Cash in", preview.controlTotals.cashIn],
                            ["Cash out", preview.controlTotals.cashOut],
                          ] as const
                        ).map(([label, amount]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd className="font-medium">
                              {label === "Rows"
                                ? amount
                                : formatCurrency(amount, preview.currency)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <ul
                        className="max-h-64 space-y-1 overflow-auto text-sm"
                        aria-label="Validated source rows"
                      >
                        {preview.rows.map((entry) => (
                          <li key={`${entry.attachmentId}:${entry.row}`}>
                            {entry.type} · row {entry.row} · {entry.sourceKey}
                          </li>
                        ))}
                      </ul>
                      <Button
                        disabled={
                          pending ||
                          !!action ||
                          preview.revision !== row.revision
                        }
                        onClick={() =>
                          void run(
                            makeAction(
                              "confirmImport",
                              {
                                batchId: row.id,
                                previewHash: preview.previewHash,
                                controlTotals: preview.controlTotals,
                              },
                              batchRef
                            )
                          )
                        }
                      >
                        Commit entire batch
                      </Button>
                    </>
                  )}
                </div>
              )}
            </section>
          )}
          {!!row.importedRecords?.length && (
            <section className="space-y-2 rounded-lg border p-4">
              <h2 className="font-semibold">Imported records</h2>
              <ul className="space-y-2">
                {row.importedRecords.map((record) => (
                  <li key={record.href}>
                    <Link
                      prefetch={false}
                      href={record.href}
                      className="underline"
                    >
                      {record.type} · row {record.row} · {record.sourceKey}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <h2 className="font-semibold">Current authorized upload intents</h2>
          {row.uploads === undefined ? (
            <p>
              Upload metadata is unavailable under your current permissions.
            </p>
          ) : !row.uploads.length ? (
            <p>No authorized source uploads yet.</p>
          ) : (
            <ul className="space-y-3">
              {row.uploads.map((upload, index) => {
                const refs =
                  !!row.id &&
                  !!row.revision &&
                  !!upload.uploadId &&
                  !!upload.revision &&
                  ability.can("update", "ImportBatch", "uploads") &&
                  (ability.can("create", "Document") ||
                    ability.can("update", "Document", "uploadId"))
                const live =
                  upload.state === "FINALIZING" &&
                  !!upload.claimExpiresAt &&
                  new Date(upload.claimExpiresAt).valueOf() > Date.now()
                const expired =
                  !!upload.expiresAt &&
                  new Date(upload.expiresAt).valueOf() <= Date.now()
                return (
                  <li
                    key={upload.uploadId ?? index}
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <p className="font-medium break-words">
                      {upload.filename ?? "Filename unavailable"}
                    </p>
                    <p>{upload.state ?? "State unavailable"}</p>
                    <p className="text-sm break-words">
                      Original upload expiry:{" "}
                      {upload.expiresAt ?? "Unavailable"}
                    </p>
                    {upload.state === "FINALIZING" && (
                      <p role="status">
                        {live
                          ? "Finalization in progress until"
                          : "Interrupted finalization; explicit recovery is available after"}{" "}
                        {upload.claimExpiresAt ?? "Lease unavailable"}. Recovery
                        only checks the persisted final attempt; it cannot
                        accept new bytes.
                      </p>
                    )}
                    {upload.state === "FAILED" && (
                      <p>
                        Failed intent retained. Start a new upload; no
                        attachment is linked.
                      </p>
                    )}
                    {upload.state === "INIT" && expired && (
                      <p>
                        Expired. Start a new upload with a new key and current
                        batch revision.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {refs && upload.state === "INIT" && !expired && (
                        <>
                          <Button
                            variant="outline"
                            disabled={!file || pending || !!action}
                            onClick={async () => {
                              if (!file) return
                              setPending(true)
                              setError("")
                              try {
                                await send(upload.uploadId!, file)
                                await refresh()
                              } catch (cause) {
                                setError(
                                  cause instanceof RequestError
                                    ? cause.code
                                    : "Upload failed"
                                )
                              } finally {
                                setPending(false)
                              }
                            }}
                          >
                            Send selected bytes to this intent
                          </Button>
                          <Button
                            disabled={pending || !!action}
                            onClick={() =>
                              void run(
                                makeAction(
                                  "completeUpload",
                                  { uploadId: upload.uploadId },
                                  [
                                    {
                                      type: "ImportBatch",
                                      id: row.id!,
                                      revision: row.revision!,
                                    },
                                    {
                                      type: "UploadIntent",
                                      id: upload.uploadId!,
                                      revision: upload.revision!,
                                    },
                                  ]
                                )
                              )
                            }
                          >
                            Finalize retained bytes
                          </Button>
                        </>
                      )}
                      {refs &&
                        upload.state === "FINALIZING" &&
                        !live &&
                        upload.claimExpiresAt && (
                          <Button
                            disabled={pending || !!action}
                            onClick={() =>
                              void run(
                                makeAction(
                                  "completeUpload",
                                  { uploadId: upload.uploadId },
                                  [
                                    {
                                      type: "ImportBatch",
                                      id: row.id!,
                                      revision: row.revision!,
                                    },
                                    {
                                      type: "UploadIntent",
                                      id: upload.uploadId!,
                                      revision: upload.revision!,
                                    },
                                  ]
                                )
                              )
                            }
                          >
                            Recover persisted final attempt
                          </Button>
                        )}
                      {upload.state === "FINAL" && upload.attachmentId && (
                        <Button
                          variant="outline"
                          onClick={() => void download(upload.attachmentId!)}
                        >
                          Download verified source
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void query.refetch()}
          >
            Refresh current state
          </Button>
        </>
      )}
    </section>
  )
}
