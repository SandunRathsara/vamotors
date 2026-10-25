import { z } from "zod"
import { grantSchema } from "./permissions"
export const id = z.string().uuid()
export const revision = z.number().int().min(1).max(2147483647)
const text = z.string().trim().min(1).max(2000)
const name = text.max(200)
const roleIds = z
  .array(id)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length)
export const commandInputs = {
  createUser: z
    .object({
      name,
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(12).max(128),
      roleIds,
    })
    .strict(),
  updateUser: z
    .object({ id, name, active: z.boolean(), roleIds, reason: text })
    .strict(),
  saveRole: z
    .object({
      id: id.optional(),
      name,
      grants: z.array(grantSchema).max(100),
      reason: text,
    })
    .strict(),
  archiveRole: z.object({ id, reason: text }).strict(),
} as const
export type CommandName = keyof typeof commandInputs
export function envelopeSchema<N extends CommandName>(command: N) {
  return z
    .object({
      schemaVersion: z.literal(1),
      idempotencyKey: id,
      expected: z
        .array(
          z.object({ type: z.enum(["User", "Role"]), id, revision }).strict()
        )
        .max(1000)
        .refine(
          (refs) =>
            new Set(refs.map((r) => `${r.type}:${r.id}`)).size === refs.length
        ),
      input: commandInputs[command],
    })
    .strict()
}
export const listParams = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce
      .number()
      .refine((v) => [10, 20, 50, 100].includes(v))
      .default(20),
  })
  .strict()
