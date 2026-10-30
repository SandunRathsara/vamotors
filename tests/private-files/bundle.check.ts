// Real, test-owned Next/Turbopack production app. No permanent application route.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises"
import { createServer } from "node:net"
import { dirname, join, relative, resolve } from "node:path"

const parent = process.env.T06A_TEST_PARENT
assert(parent)
const project = await mkdtemp(join(parent, "next-bundle-"))
await mkdir(join(project, "lib/server"), { recursive: true, mode: 0o700 })
await cp(
  "lib/server/private-files",
  join(project, "lib/server/private-files"),
  { recursive: true }
)
await symlink(resolve("node_modules"), join(project, "node_modules"))
await cp("package.json", join(project, "package.json"))
await cp("pnpm-lock.yaml", join(project, "pnpm-lock.yaml"))
await writeFile(
  join(project, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      lib: ["dom", "esnext"],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: "react-jsx",
    },
    include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  })
)
let common = project
while (relative(common, process.cwd()).startsWith(".."))
  common = dirname(common)
await writeFile(
  join(project, "next.config.mjs"),
  `export default {turbopack:{root:${JSON.stringify(common)}}}`
)
const bytesRoot = join(parent, project.split("/").at(-1) + "-bytes")
await mkdir(bytesRoot, { mode: 0o700 })
await mkdir(join(project, "app/api/probe"), { recursive: true })
await writeFile(
  join(project, "app/layout.tsx"),
  "export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}"
)
await writeFile(
  join(project, "app/page.tsx"),
  "export default function Page(){return <p>Private test probe</p>}"
)
await writeFile(
  join(project, "app/api/probe/route.ts"),
  `
import {openPrivateFiles} from "../../../lib/server/private-files/index"
import {digest} from "../../../lib/server/private-files/validation"
import {randomUUID} from "node:crypto"
import {writeFile} from "node:fs/promises"
import {join} from "node:path"
export const runtime="nodejs"
export async function POST(request:Request){
 const bytes=Buffer.from(await request.arrayBuffer());
 const store=await openPrivateFiles({root:${JSON.stringify(bytesRoot)},environmentId:"11111111-1111-4111-8111-111111111111",forbiddenRoots:[process.cwd()],mayWrite:()=>true});
 try{
  const d={size:bytes.length,sha256:digest(bytes),mime:request.headers.get("content-type")!,filename:request.headers.get("x-filename")!};
  const intent=randomUUID(),stage=store.newStageKey(intent),final=store.newFinalKey(intent,randomUUID());
  await store.writeStage(stage,(async function*(){yield bytes})(),d);
  const snapshot=await store.validateStage(stage,d);
  await writeFile(join(${JSON.stringify(bytesRoot)},stage),"changed after validation");
  const metadata=await store.finalize(final,snapshot);
  const retained=await store.readFinal(final,metadata);
  const replay=await store.finalize(final,snapshot);
  if(JSON.stringify(replay)!==JSON.stringify(metadata))throw Error("replay");
  return Response.json({accepted:true,sha256:digest(retained),size:retained.length,key:final,metadata});
 }catch(e){const code=(e as {code:string}).code;return Response.json({accepted:false,code},{status:code==="STORAGE_UNAVAILABLE"?503:422})}finally{await store.close()}
}
`
)
// app/api/probe -> project/lib is three parent components.
const next = resolve("node_modules/next/dist/bin/next")
async function build() {
  const child = spawn(process.execPath, [next, "build"], {
    cwd: project,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (b) => {
    output += b
  })
  child.stderr.on("data", (b) => {
    output += b
  })
  const deadline = setTimeout(() => child.kill("SIGKILL"), 90_000)
  const status = await new Promise<number | null>((r) => child.on("close", r))
  clearTimeout(deadline)
  await writeFile(join(project, "build.log"), output, { mode: 0o600 })
  assert.equal(status, 0, output)
}
console.log(`retained bundle probe: ${project}`)
await build()
const listener = createServer()
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r))
const port = (listener.address() as { port: number }).port
await new Promise<void>((r) => listener.close(() => r()))
const child = spawn(
  process.execPath,
  [next, "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: project,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }
)
const checkpoints: { path: string; sha256: string }[] = []
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Next startup timeout")),
      30_000
    )
    child.stdout.on("data", (b) => {
      if (String(b).includes("Ready")) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.once("exit", () => {
      clearTimeout(timeout)
      reject(new Error("Next exited before ready"))
    })
  })
  const root = process.env.T06A_REVIEW_FIXTURES
  assert(root)
  const results = []
  const cases: [string, string, number, string][] = [
    ...(
      [
        ["pillow-exif.jpg", "image/jpeg", 200],
        ["pillow-icc.png", "image/png", 200],
        ["pillow-exif.webp", "image/webp", 200],
        ["reportlab-scan.pdf", "application/pdf", 200],
        [
          "openpyxl.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          200,
        ],
        ["equivalent.csv", "text/csv", 200],
        ["in-chunk-polyglot.webp", "image/webp", 422],
        ["pypdf-image-short-flate.pdf", "application/pdf", 422],
      ] as [string, string, number][]
    ).map(
      ([name, mime, status]) =>
        [name, mime, status, join(root, "fixtures", name)] as [
          string,
          string,
          number,
          string,
        ]
    ),
  ]
  const r2 = process.env.T06A_R2_FIXTURES
  if (r2) {
    const red = JSON.parse(
      await readFile(join(r2, "red-results.json"), "utf8")
    ) as { name: string; expected: boolean; accepted: boolean }[]
    const focus = new Set(
      red.filter((r) => r.expected !== r.accepted).map((r) => r.name)
    )
    for (const group of ["extended", "limits"]) {
      const manifest = JSON.parse(
        await readFile(join(r2, group, "manifest.json"), "utf8")
      ) as { name: string; expected: boolean }[]
      for (const f of manifest) {
        if (
          !focus.has(f.name) &&
          !f.name.includes("inline") &&
          group !== "limits"
        )
          continue
        cases.push([
          f.name,
          f.name.endsWith(".pdf") ? "application/pdf" : "image/webp",
          f.expected ? 200 : 422,
          join(r2, group, f.name),
        ])
      }
    }
  }
  for (const [name, mime, expected, path] of cases) {
    const bytes: Buffer = await readFile(path)
    const response: Response = await fetch(
      `http://127.0.0.1:${port}/api/probe`,
      {
        method: "POST",
        headers: { "content-type": mime, "x-filename": name },
        body: new Uint8Array(bytes),
      }
    )
    const body: {
      accepted: boolean
      code?: string
      sha256?: string
      size?: number
      key?: string
      metadata?: unknown
    } = await response.json()
    results.push({ name, status: response.status, body })
    assert.equal(response.status, expected, JSON.stringify(results))
    if (expected === 422)
      assert.deepEqual(body, { accepted: false, code: "UPLOAD_MISMATCH" })
    else {
      assert.equal(body.accepted, true)
      assert.equal(
        body.sha256,
        createHash("sha256").update(bytes).digest("hex")
      )
      assert.equal(body.size, bytes.length)
      const checkpoint = join(project, `checkpoint-${checkpoints.length}.json`)
      await writeFile(
        checkpoint,
        JSON.stringify({ key: body.key, metadata: body.metadata }),
        { mode: 0o600 }
      )
      checkpoints.push({ path: checkpoint, sha256: body.sha256! })
    }
  }
  const worker = join(project, "lib/server/private-files/document-worker.mjs")
  await rename(worker, worker + ".held")
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/probe`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-filename": "valid.png" },
      body: new Uint8Array(
        await readFile(join(root, "fixtures/pillow-plain.png"))
      ),
    })
    const body = await response.json()
    results.push({ name: "missing-worker", status: response.status, body })
    assert.equal(response.status, 503)
    assert.equal(body.code, "STORAGE_UNAVAILABLE")
  } finally {
    await rename(worker + ".held", worker)
  }
  await writeFile(
    join(project, "http-results.json"),
    JSON.stringify(results, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(results))
} finally {
  child.kill("SIGTERM")
  await new Promise<void>((r) => child.on("close", () => r()))
}
// The actual Next writer is stopped. Re-open every immutable final in a fresh
// independent process using the same adapter, exact metadata and original hash.
for (const checkpoint of checkpoints) {
  const restarted = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/private-files/restart.ts",
      "read",
      bytesRoot,
      "11111111-1111-4111-8111-111111111111",
      checkpoint.path,
    ],
    { encoding: "utf8", timeout: 15000 }
  )
  assert.equal(restarted.status, 0, restarted.stderr)
  assert.equal(JSON.parse(restarted.stdout).sha256, checkpoint.sha256)
}
await writeFile(
  join(project, "restart-results.json"),
  JSON.stringify(checkpoints),
  { mode: 0o600 }
)
console.log(`HTTP finals restarted exactly: ${checkpoints.length}`)
