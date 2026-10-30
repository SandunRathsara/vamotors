// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { subject } from "@casl/ability"
vi.mock("server-only", () => ({}))
import {
  attachmentCommands,
  attachmentEnvelope,
} from "../../lib/server/validators"
import { importList, uploadDTO } from "../../lib/server/import-staging"
import { sanitizeFilename } from "../../lib/server/attachments"
import {
  registry,
  grantSchema,
  abilityFor,
  attenuation,
} from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"
const uuid = "03000000-0000-4000-8000-000000000011"
const init = {
  target: { type: "IMPORT_BATCH", id: uuid },
  purpose: "IMPORT_SOURCE",
  filename: "source.csv",
  contentType: "text/csv",
  size: 17,
  sha256: "a".repeat(64),
}
describe("T06b staging trust boundaries", () => {
  it("canonicalizes UUIDs before request hashing, FK checks and recovery identity", () => {
    const canonical = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    const reference = { type: "UploadIntent", id: canonical, revision: 1 }
    const input = attachmentEnvelope("completeUpload").parse({
      schemaVersion: 1,
      idempotencyKey: canonical.toUpperCase(),
      expected: [{ ...reference, id: canonical.toUpperCase() }],
      input: { uploadId: canonical.toUpperCase() },
    })
    expect(input.idempotencyKey).toBe(canonical)
    expect(input.expected[0].id).toBe(canonical)
    expect(input.input).toEqual({ uploadId: canonical })
    expect(
      attachmentEnvelope("completeUpload").safeParse({
        schemaVersion: 1,
        idempotencyKey: canonical,
        expected: [reference, { ...reference, id: canonical.toUpperCase() }],
        input: { uploadId: canonical },
      }).success
    ).toBe(false)
  })
  it("accepts only real import staging declarations, never a fabricated owner/preview", () => {
    expect(
      attachmentCommands.stageImport.parse({
        types: ["SUPPLIERS", "VEHICLES"],
        namespace: " retained ",
      }).namespace
    ).toBe("retained")
    for (const bad of [[], ["SUPPLIERS", "SUPPLIERS"], ["FINANCE_COMPANIES"]])
      expect(
        attachmentCommands.stageImport.safeParse({ types: bad, namespace: "n" })
          .success
      ).toBe(false)
    for (const extra of [
      { actor: uuid },
      { previewHash: "fake" },
      { state: "VALIDATED" },
    ])
      expect(
        attachmentCommands.stageImport.safeParse({
          types: ["VEHICLES"],
          namespace: "n",
          ...extra,
        }).success
      ).toBe(false)
    expect(attachmentCommands.initUpload.safeParse(init).success).toBe(true)
    for (const patch of [
      { target: { type: "VEHICLE", id: uuid } },
      { target: { type: "SALE_CASE", id: uuid } },
      { purpose: "DO" },
      { category: "FRONT" },
      { type: "SALES" },
      { size: 5242881 },
      { size: 0 },
      { size: "17" },
      { contentType: "application/pdf" },
      { sha256: "A".repeat(64) },
      { stagingKey: "forged" },
    ])
      expect(
        attachmentCommands.initUpload.safeParse({ ...init, ...patch }).success
      ).toBe(false)
    expect(
      attachmentCommands.completeUpload.safeParse({
        uploadId: uuid,
        attemptId: uuid,
      }).success
    ).toBe(false)
    const ref = { type: "ImportBatch", id: uuid, revision: 1 }
    expect(
      attachmentEnvelope("initUpload").safeParse({
        schemaVersion: 1,
        idempotencyKey: uuid,
        input: init,
        expected: [ref, ref],
      }).success
    ).toBe(false)
  })
  it("keeps the accepted v8 capability universes byte-identical; no import or upload verb", () => {
    const old = Object.fromEntries(
      Object.entries(registry).filter(
        ([name]) => !["Document", "ImportBatch"].includes(name)
      )
    )
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(
      "94631effa4d5df2ef1122a886d4ff9bd195474f68e2ff18caa7fe1bc635797f4"
    )
    for (const action of ["upload", "import", "approve"])
      expect(
        grantSchema.safeParse({ subject: "ImportBatch", action, fields: ["*"] })
          .success
      ).toBe(false)
    for (const path of [
      "stagingKey",
      "finalKey",
      "currentAttemptId",
      "previewHash",
    ])
      expect(
        grantSchema.safeParse({
          subject: "Document",
          action: "read",
          fields: [path],
        }).success
      ).toBe(false)
    const ceiling: Grant[] = [
      {
        subject: "ImportBatch",
        action: "read",
        fields: ["*"],
        conditions: { createdBy: "$actor.id" },
      },
    ]
    expect(
      attenuation(
        ceiling,
        [],
        [{ subject: "Document", action: "create", fields: ["*"] }],
        uuid
      ).covered
    ).toBe(false)
    expect(
      abilityFor(ceiling, uuid).can(
        "read",
        subject("ImportBatch", { createdBy: "foreign" })
      )
    ).toBe(false)
  })
  it("scopes before predicates/counts and enforces exact Colombo dates/default order", () => {
    const actor = {
      userId: uuid,
      grants: [
        {
          subject: "ImportBatch",
          action: "read",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        },
      ] as Grant[],
    }
    const list = importList(actor, {
      namespace: "A",
      q: "a%_",
      from: "2026-10-30",
      through: "2026-10-30",
    })
    expect(list.paging.orderBy).toEqual([{ createdAt: "desc" }, { id: "asc" }])
    expect(list.where.AND).toEqual(
      expect.arrayContaining([{ OR: [{ createdBy: uuid }] }])
    )
    expect(JSON.stringify(list.where)).toContain("2026-10-29T18:30:00.000Z")
    expect(JSON.stringify(list.where)).toContain("2026-10-30T18:30:00.000Z")
    expect(JSON.stringify(list.where)).toContain("a\\\\%\\\\_")
    for (const raw of [
      { surprise: "x" },
      { state: "FINAL" },
      { from: "2026-02-30" },
      { sort: '[{"field":"createdBy","direction":"asc"}]' },
      { sort: "[]" },
      { from: "2026-10-31", through: "2026-10-30" },
    ])
      expect(() => importList(actor, raw)).toThrow("INVALID_INPUT")
    expect(() =>
      importList(
        {
          ...actor,
          grants: [
            {
              subject: "ImportBatch",
              action: "read",
              fields: ["id", "revision"],
            },
          ],
        },
        {}
      )
    ).toThrow("FIELD_FORBIDDEN")
  })
  it("projects only original expiry and persisted lease observations, never keys/tokens", () => {
    const row = {
      id: uuid,
      revision: 2,
      filename: "source.csv",
      expiresAt: new Date("2026-10-30T01:00:00Z"),
      state: "FINALIZING",
      claimExpiresAt: new Date("2026-10-30T01:03:00Z"),
      stagingKey: "private",
      currentAttempt: { finalKey: "private" },
      attachment: null,
    }
    expect(uploadDTO(row as never)).toEqual({
      uploadId: uuid,
      revision: 2,
      filename: "source.csv",
      expiresAt: "2026-10-30T01:00:00.000Z",
      state: "FINALIZING",
      attachmentId: null,
      claimExpiresAt: "2026-10-30T01:03:00.000Z",
    })
    expect(sanitizeFilename("../../bad\nname.csv")).toBe("badname.csv")
    expect(sanitizeFilename("C:\\private\\file.xlsx")).toBe("file.xlsx")
  })
})
