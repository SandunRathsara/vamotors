import { test as setup } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const userFile = 'playwright/.auth/user.json';

setup('scaffold empty auth state', async ({ page }) => {
  // Phase 0.3: scaffold-only. Write an empty storage state so the file exists
  // and Phase 1's `use.storageState` reference does not crash when wired.
  // Phase 1 replaces this body with Better Auth credential sign-in.
  await mkdir(dirname(userFile), { recursive: true });
  await page.goto('/');
  await page.context().storageState({ path: userFile });
});
