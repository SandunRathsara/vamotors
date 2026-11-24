# VA Motors Vehicle Sale Management System

VA Motors runs on loopback with PostgreSQL and a private file directory. Sign in with a provisioned account. The local setup creates two synthetic administrators and a restricted staff account for development and testing.

## Set up and run locally

Use Node.js 24 LTS, pnpm, and the PostgreSQL 18 server tools. Set `PG_BIN` to the directory containing `postgres`, `initdb`, and `pg_ctl` if the setup script cannot find them. The first production build downloads Inter through Next.js.

```sh
pnpm install --frozen-lockfile
pnpm local:setup
pnpm local:dev
```

Open `http://127.0.0.1:8000`. Setup prints the private state directory. Read the generated login credentials from its `accounts.env` file. Keep the directory outside Git and accessible only to your OS account. The application reads its database and private-file configuration from `runtime.env` in that same directory.

Stop the foreground app with Ctrl+C and stop PostgreSQL with `pnpm local:stop`. Run `pnpm local:start` to start the same cluster again. `pnpm local:dev` also starts the cluster if needed. Records and files persist across stops. Use the same `VAMOTORS_LOCAL_DIR` for all commands that belong to a given cluster.

The installable PWA registers its service worker in a production build on a secure origin, including loopback. Use your browser’s install menu when offered. The app needs a connection to its local server for all business records and files.

## Test in an isolated cluster

Choose a new private directory outside the checkout. The browser harness starts its own production app on a free loopback port. The API and browser tests create synthetic data through authenticated services.

```sh
export VAMOTORS_LOCAL_DIR="$HOME/.local/state/vamotors/qa-$(date +%s)"
pnpm local:setup
pnpm typecheck
pnpm lint
pnpm test:unit
node --test tests/pwa/service-worker.test.mjs
pnpm build
pnpm exec playwright install chromium firefox webkit
pnpm test:api
pnpm test:e2e
pnpm exec playwright test --project=firefox-360 --project=firefox-1920 --project=webkit-360 --project=webkit-1920
node --import tsx tests/pwa/production-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm local:test
pnpm local:stop
```

Run the real-DB security check last or on a separate test cluster. It exercises account deactivation and revocation.

## Reservation expiry

With the app running, run `pnpm local:expiry` in a second terminal. It sweeps at startup and every minute. Stop the scheduler with Ctrl+C. Run `pnpm local:expiry --catch-up` for a single run, or use **Run expiry catch-up** on Sales if your role permits it. For an alternate loopback app port, set `EXPIRY_BASE_URL` to its origin. Setup generates the scheduler secret file.

## Backup and restore

Stop the app and the expiry scheduler so the database and private files remain consistent. Keep PostgreSQL running for the backup. In a private shell, use the loopback source database URL from `migration.env` and the file root from `runtime.env`. Set `PG_BIN` if necessary to locate `pg_dump`, `pg_restore`, and `psql`.

```sh
# In a private shell, set STATE to the source state directory and BACKUP to a new off-Git path.
. "$STATE/migration.env"
. "$STATE/runtime.env"
DATABASE_URL="$DIRECT_URL" node --import tsx scripts/local-backup-restore.ts backup \
  --private-file-root "$PRIVATE_FILES_ROOT" --output-dir "$BACKUP"
node --import tsx scripts/local-backup-restore.ts verify --backup-dir "$BACKUP"
```

Create an empty database on an isolated loopback PostgreSQL instance with an owner that can restore the `vamotors` schema. Set `TARGET_DATABASE_URL` privately and choose a separate, empty `TARGET_FILES` directory. Keep the source URL and source file root available to enforce source protection.

```sh
node --import tsx scripts/local-backup-restore.ts restore \
  --backup-dir "$BACKUP" \
  --source-database-url "$DIRECT_URL" --source-private-file-root "$PRIVATE_FILES_ROOT" \
  --target-database-url "$TARGET_DATABASE_URL" --target-private-file-root "$TARGET_FILES"
node --import tsx scripts/local-backup-restore.ts verify --backup-dir "$BACKUP" \
  --target-database-url "$TARGET_DATABASE_URL" --target-private-file-root "$TARGET_FILES"
```

The archive contains business data, credential hashes and private documents. Restrict access to it and the restored files.
