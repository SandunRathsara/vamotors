/** Shared with offline schema generation; no database access or secret reads. */
export const authOptions = {
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
