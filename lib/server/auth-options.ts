import { APIError } from "better-auth/api"

/** Shared with offline schema generation; no database access or secret reads. */
export const authOptions = {
  // The default logger/router can print Prisma SQL and failing-row secrets
  // before our HTTP sanitizer runs. Shared by every Better Auth instance.
  logger: { disabled: true },
  onAPIError: {
    onError: (error: unknown) => {
      // Returning void still reaches better-call's console.error fallback.
      // Throwing a safe APIError makes that router return without logging.
      if (error instanceof APIError && error.statusCode < 500) throw error
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "AUTHENTICATION_UNAVAILABLE",
      })
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: { cookieCache: { enabled: false } },
  advanced: { database: { generateId: "uuid" as const } },
  disabledPaths: [
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/change-email",
    "/delete-user",
    "/update-user",
    "/change-password",
    "/set-password",
    "/link-social",
    "/sign-in/social",
  ],
  user: {
    additionalFields: {
      active: { type: "boolean" as const, defaultValue: true, input: false },
      authzRevision: { type: "number" as const, defaultValue: 1, input: false },
    },
  },
}
