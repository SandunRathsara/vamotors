"use client"

import { useState } from "react"
import type { ReportExportStatus } from "@/lib/server/report-http"
import { Button } from "@/components/ui/button"

const endpoint = "/api/v1/report-exports"

async function request<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" }
  )
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 409
        ? "This export is unavailable. Refresh the report or start a new export."
        : "Export request failed. Open saved exports to resume."
    )
  return (await response.json()).data
}

type SavedJobs = {
  id: string
  format: string
  snapshotAt: string
  state: string
}[]

export function ReportExportControls({
  query,
  kind,
}: {
  query: string
  kind: string
}) {
  const [job, setJob] = useState<ReportExportStatus>()
  const [jobs, setJobs] = useState<SavedJobs>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  async function run(task: () => Promise<void>) {
    setError("")
    setPending(true)
    try {
      await task()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Export request failed."
      )
    } finally {
      setPending(false)
    }
  }
  async function render(status: ReportExportStatus) {
    setJob(status)
    while (status.state !== "READY") {
      status = await request<ReportExportStatus>(`${endpoint}/${status.id}`, {
        revision: status.revision,
      })
      setJob(status)
      if (status.state === "PAUSED_QUOTA") break
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {["csv", "pdf"].map((format) => (
          <Button
            key={format}
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                const started = await request<ReportExportStatus>(endpoint, {
                  id: crypto.randomUUID(),
                  format,
                  query,
                })
                setJobs(undefined)
                await render(started)
              })
            }
          >
            Export {format.toUpperCase()}
          </Button>
        ))}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              setJobs(await request<SavedJobs>(`${endpoint}?kind=${kind}`))
            })
          }
        >
          Saved exports
        </Button>
      </div>
      {jobs && (
        <ul className="space-y-1 text-sm">
          {!jobs.length && <li>No saved exports.</li>}
          {jobs.map(({ id, format, snapshotAt, state }) => (
            <li key={id}>
              <Button
                variant="link"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    setJob(
                      await request<ReportExportStatus>(`${endpoint}/${id}`)
                    )
                  })
                }
              >
                {format.toUpperCase()} · {new Date(snapshotAt).toLocaleString()}{" "}
                · {state.replaceAll("_", " ").toLowerCase()}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm">
          Preparing export…
        </p>
      )}
      {job && !job.complete && (
        <div className="space-y-1 text-sm">
          <p>
            {job.renderedRows} of {job.totalRows} rows prepared.
          </p>
          {job.state === "PAUSED_QUOTA" && (
            <p>Private storage is at capacity.</p>
          )}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await render(
                  await request<ReportExportStatus>(`${endpoint}/${job.id}`)
                )
              })
            }
          >
            Resume export
          </Button>
        </div>
      )}
      {job?.complete && (
        <ul aria-label="Export downloads" className="space-y-1 text-sm">
          {job.parts.map((part) => (
            <li key={part.id}>
              <a
                className="underline"
                href={`${endpoint}/${job.id}/${part.id}`}
                download
              >
                Download {job.format.toUpperCase()}
                {job.parts.length > 1 ? ` part ${part.ordinal}` : ""}
              </a>
            </li>
          ))}
          <li>
            <a
              className="underline"
              href={`${endpoint}/${job.id}?manifest=1`}
              download="manifest.json"
            >
              Download manifest
            </a>
          </li>
        </ul>
      )}
    </div>
  )
}
