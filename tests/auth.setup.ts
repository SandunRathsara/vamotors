import { test as setup } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const userFile = 'playwright/.auth/user.json';

setup('scaffold empty auth state', async ({ browser }) => {
  // Phase 0.3: scaffold-only. Write an empty storage state so the file exists
  // and Phase 1's `use.storageState` reference does not crash when wired.
  // Phase 1 replaces this body with Better Auth credential sign-in.
  //
  // Intentionally no page.goto() — storageState() can be written from a fresh
  // context without visiting any route. This avoids coupling setup to a known
  // URL (`/` may not exist in the current app), which would cascade-fail both
  // the `api` and `e2e` projects via their `dependencies: ['setup']`.
  await mkdir(dirname(userFile), { recursive: true });
  const context = await browser.newContext();
  await context.storageState({ path: userFile });
  await context.close();
});
