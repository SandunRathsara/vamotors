import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These files assert type assignability or follow TanStack's generic declaration shape.
    files: [".planning/implementation/contracts/*check.ts", "types/data-table.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    // Static design exploration uses HTML inline handlers and is outside the application.
    "design/**",
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
