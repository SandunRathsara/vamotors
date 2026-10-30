/** Retained T06b fixtures; capability URLs/headers and passwords never enter logs. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { request, type APIRequestContext } from "@playwright/test"
import type {
  Applied,
  DownloadDTO,
  Grant,
  ImportBatchFilesDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"
import { validFixtures } from "../private-files/fixtures"
import { envelope, fixture, ref } from "./cycle-edits-fixture"

type Local = Awaited<ReturnType<typeof fixture>>
export type RetainedFiles = {
  attachments: { id: string; batchId: string; size: number; sha256: string }[]
  readers: { email: string; status: number }[]
}
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex")
const password = (f: Local, email: string) =>
  hash(`${f.runtime.BETTER_AUTH_SECRET}:${email}`)

export async function seedFiles(f: Local, admin: APIRequestContext) {
  const retained: RetainedFiles = { attachments: [], readers: [] },
    xlsx = (await validFixtures()).find((v) => v.filename === "valid.xlsx")!
  for (const file of [
    {
      filename: "retained.csv",
      mime: "text/csv",
      bytes: Buffer.from(
        "sourceKey,type,name\nretained,SUPPLIERS,Synthetic retained\n"
      ),
    },
    xlsx,
  ]) {
    const staged = await f.command(
      admin,
      "stageImport",
      envelope({ types: ["SUPPLIERS"], namespace: `Edits-${randomUUID()}` }),
      201
    )
    const detail = () =>
      f.query<ImportBatchFilesDTO>(
        admin,
        "importBatchFiles",
        `?id=${staged.result.id}`
      )
    let batch = await detail()
    // Raw handling is intentional: UploadReady contains secret capabilities.
    const response = await admin.post("/api/v1/commands/initUpload", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          target: { type: "IMPORT_BATCH", id: batch.id },
          purpose: "IMPORT_SOURCE",
          filename: file.filename,
          contentType: file.mime,
          size: file.bytes.length,
          sha256: hash(file.bytes),
        },
        [ref(batch, "ImportBatch")]
      ),
    })
    assert.equal(response.status(), 201)
    const ready = (await response.json()) as UploadReady
    assert.equal(ready.status, "UPLOAD_READY")
    const put = await admin.put(ready.putUrl, {
      headers: { Origin: f.origin, ...ready.requiredHeaders },
      data: file.bytes,
    })
    assert.equal(put.status(), 204)
    batch = await detail()
    const intent = batch.uploads.find((u) => u.uploadId === ready.uploadId)!
    const completed = await f.command(
      admin,
      "completeUpload",
      envelope({ uploadId: ready.uploadId }, [
        ref(batch, "ImportBatch"),
        { type: "UploadIntent", id: ready.uploadId, revision: intent.revision },
      ])
    )
    retained.attachments.push({
      id: completed.result.id,
      batchId: batch.id,
      size: file.bytes.length,
      sha256: hash(file.bytes),
    })
    assert.equal((await detail()).state, "STAGED")
  }
  for (const status of [200, 403, 404]) {
    const grants: Grant[] = [
      {
        subject: "ImportBatch",
        action: "read",
        fields: ["*"],
        ...(status === 404 ? { conditions: { createdBy: "$actor.id" } } : {}),
      },
      {
        subject: "Document",
        action: "read",
        fields:
          status === 403
            ? [
                "uploadId",
                "revision",
                "filename",
                "expiresAt",
                "state",
                "attachmentId",
                "claimExpiresAt",
                "contentType",
                "size",
                "sha256",
              ]
            : ["*"],
      },
    ]
    const role = await f.command(
      admin,
      "saveRole",
      envelope({
        name: `Retained files ${status} ${randomUUID()}`,
        reason: "Synthetic retained current file authority",
        grants,
      }),
      201
    )
    const email = `retained-${randomUUID()}@example.test`
    const response = await admin.post("/api/v1/commands/createUser", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          name: `Retained file reader ${status}`,
          email,
          password: password(f, email),
          roleIds: [role.result.id],
        },
        [ref(role.result, "Role")]
      ),
    })
    assert.equal(response.status(), 201)
    assert.equal(((await response.json()) as Applied).status, "APPLIED")
    retained.readers.push({ email, status })
  }
  return retained
}

export async function fileBytes(f: Pick<Local, "db" | "runtime">) {
  const rows = (
    await f.db.query(
      'SELECT id,"finalKey",size,sha256 FROM vamotors."Attachment" ORDER BY id'
    )
  ).rows
  const bytes = []
  for (const row of rows) {
    const actual = await readFile(
      join(f.runtime.PRIVATE_FILES_ROOT!, row.finalKey)
    )
    assert.equal(actual.length, Number(row.size))
    assert.equal(hash(actual), row.sha256)
    bytes.push({
      id: row.id as string,
      size: actual.length,
      sha256: hash(actual),
    })
  }
  return bytes
}

export async function verifyFiles(f: Local, retained: RetainedFiles) {
  const before = await f.snapshot([
      "ImportBatch",
      "UploadIntent",
      "UploadAttempt",
      "Attachment",
      "UploadEvent",
      "CommandReceipt",
      "EntityReadVersion",
      "BusinessSequence",
      "AuditEntry",
    ]),
    bytes = await fileBytes(f),
    clients: APIRequestContext[] = []
  try {
    // Three sign-ins per app instance: respect the accepted auth limiter without
    // sleeping, forged proxy headers or disabling production protection.
    await f.stop()
    await f.start()
    const anonymous = await request.newContext({ baseURL: f.origin })
    clients.push(anonymous)
    const readers = []
    for (const reader of retained.readers) {
      const client = await request.newContext({ baseURL: f.origin })
      clients.push(client)
      const login = await client.post("/api/auth/sign-in/email", {
        headers: { Origin: f.origin },
        data: { email: reader.email, password: password(f, reader.email) },
      })
      assert.equal(login.status(), 200)
      readers.push({ client, status: reader.status })
    }
    for (const attachment of retained.attachments) {
      const path = `/api/v1/queries/download?attachmentId=${attachment.id}`,
        dto = await f.query<DownloadDTO>(
          readers.find((reader) => reader.status === 200)!.client,
          "download",
          `?attachmentId=${attachment.id}`
        )
      assert.equal(dto.sha256, attachment.sha256)
      assert.equal(dto.size, attachment.size)
      for (const { client, status } of [
        ...readers,
        { client: anonymous, status: 401 },
      ]) {
        const query = await client.get(path)
        assert.equal(query.status(), status)
        assert.match(query.headers()["cache-control"], /no-store/)
        const response = await client.get(dto.url)
        assert.equal(response.status(), status)
        assert.match(response.headers()["cache-control"], /no-store/)
        if (status === 200) {
          assert.match(response.headers()["cache-control"], /private/)
          assert.equal(response.headers()["x-content-type-options"], "nosniff")
          assert.match(
            response.headers()["content-disposition"],
            /^attachment;/
          )
          const actual = await response.body()
          assert.equal(actual.length, attachment.size)
          assert.equal(hash(actual), attachment.sha256)
        }
      }
    }
    assert.deepEqual(await fileBytes(f), bytes)
    assert.equal(
      await f.snapshot([
        "ImportBatch",
        "UploadIntent",
        "UploadAttempt",
        "Attachment",
        "UploadEvent",
        "CommandReceipt",
        "EntityReadVersion",
        "BusinessSequence",
        "AuditEntry",
      ]),
      before
    )
    return {
      attachments: retained.attachments,
      statuses: [200, 403, 404, 401],
    }
  } finally {
    for (const client of clients) await client.dispose()
  }
}
