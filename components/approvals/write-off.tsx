"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { subject } from "@casl/ability"
import type { ApprovalDTO, Applied, Pending, PurchaseCycleDTO, Visible, Dependency } from "@/.planning/implementation/contracts/api"
import { approvalEnvelope } from "@/lib/server/validators"
import { abilityFor } from "@/lib/server/permissions"
import { useActor } from "@/components/providers/auth-boundary"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Cycle = Visible<PurchaseCycleDTO>
type Approval = Visible<ApprovalDTO>
const errorText = (e: unknown) => e instanceof RequestError ? e.code : e instanceof Error ? e.message : "NETWORK_ERROR"
const staleCodes = ["STALE_REVISION", "REVISION_REQUIRED", "APPROVAL_STALE", "INVALID_STATE", "ALREADY_REVIEWED"]
const money = (s: string | undefined) => s === undefined ? "Unavailable" : major(BigInt(s))

export function WriteOffRequest({ cycle }: { cycle: Cycle }) {
  const { actor } = useActor(), queries = useQueryClient()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const candidate = subject("Disposal", { createdBy: actor.user.id })
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Cycle>({}), [draft, setDraft] = useState<Record<string,string>>({}), [body, setBody] = useState<string | null>(null), [pending,setPending]=useState(false), [stale,setStale]=useState(false), [latest,setLatest]=useState<Cycle|null>(null), [message,setMessage]=useState(""), [approvalId,setApprovalId]=useState<string|null>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  function problem(value:string){setMessage(value);requestAnimationFrame(()=>alert.current?.focus())}
  const receiptAllowed = ["amount","date","method"].every(f => ability.can("create", candidate, `receipt.${f}`) && ability.can("pay", candidate, `receipt.${f}`))
  const referenceAllowed = ability.can("create", candidate, "receipt.reference") && ability.can("pay", candidate, "receipt.reference")
  const frozen = pending || stale || !!body
  function begin(){setSnapshot(cycle);setOpen(true);setBody(null);setStale(false);setLatest(null);setApprovalId(null);setDraft({proceeds:"",method:"OTHER",receiptMethod:"BANK_TRANSFER"});setMessage("")}
  async function submit(event:React.FormEvent){
    event.preventDefault();if(pending||stale)return;setPending(true)
    try{
      let submitted=body
      if(!submitted){
        if(!snapshot.id||!snapshot.revision||!snapshot.vehicleId||!snapshot.identityRevision)throw Error("Readable current cycle and physical references required")
        const proceeds=parseMajor(draft.proceeds??"")
        if(proceeds!=="0"&&!receiptAllowed)throw Error("Actual receipt field permission required for positive proceeds")
        const parsed=approvalEnvelope("requestApproval").safeParse({schemaVersion:1,idempotencyKey:crypto.randomUUID(),expected:[{type:"PurchaseRecord",id:snapshot.id,revision:snapshot.revision},{type:"Vehicle",id:snapshot.vehicleId,revision:snapshot.identityRevision}],input:{proposal:{kind:"WRITE_OFF",input:{cycleId:snapshot.id,date:draft.date??"",reason:draft.disposalReason??"",method:draft.method,proceeds,...(proceeds!=="0"?{receipt:{amount:proceeds,date:draft.receiptDate??"",method:draft.receiptMethod,...(referenceAllowed&&draft.reference?.trim()?{reference:draft.reference}:{})}}:{})}},reason:draft.requestReason??""}})
        if(!parsed.success)throw Error("Complete both reasons, actual dates, method and explicit proceeds; enter 0 for no recovery.")
        submitted=JSON.stringify(parsed.data);setBody(submitted)
      }
      const result=await privateRequest<Pending>("/api/v1/commands/requestApproval",{method:"POST",headers:{"Content-Type":"application/json"},body:submitted})
      setApprovalId(result.approvalId);setBody(null);setOpen(false);problem("Request committed. Not written off; no funds recorded.")
      for(const key of ["approvals","notifications"])void queries.invalidateQueries({queryKey:[key]})
    }catch(e){const code=errorText(e);setStale(staleCodes.includes(code));if(e instanceof RequestError&&e.status===422)setBody(null);problem(code)}finally{setPending(false)}
  }
  const set=(key:string,value:string)=>setDraft(old=>({...old,[key]:value}))
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Write-off request">
    <h2 className="text-lg font-semibold">Write-off / disposal</h2>
    {!open&&cycle.nextActions?.includes("requestApproval")&&<Button onClick={begin}>Request write-off</Button>}
    {!open&&!cycle.nextActions?.includes("requestApproval")&&<p className="text-muted-foreground">No permitted write-off request on this current cycle.</p>}
    {message&&<p ref={alert} role="alert" tabIndex={-1} className="break-words">{message}</p>}
    {approvalId&&<Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/approvals/${approvalId}`}>Open saved request</Link>}
    {open&&<form onSubmit={submit} className="space-y-4">
      <p>Current persisted basis: {money(snapshot.financial?.basis)}. Pending does not hold stock, write off the vehicle or record money.</p>
      <fieldset disabled={frozen} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="writeoff-date">Disposal date</Label><Input id="writeoff-date" type="date" required value={draft.date??""} onChange={e=>set("date",e.target.value)}/></div>
        <div className="space-y-2"><Label htmlFor="writeoff-method">Disposal method</Label><select id="writeoff-method" className="h-11 w-full rounded-md border bg-background px-3" value={draft.method} onChange={e=>set("method",e.target.value)}>{["SCRAPPED","AUCTIONED","DONATED","OTHER"].map(v=><option key={v}>{v}</option>)}</select></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="writeoff-reason">Disposal reason</Label><Textarea id="writeoff-reason" required maxLength={2000} value={draft.disposalReason??""} onChange={e=>set("disposalReason",e.target.value)}/></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="writeoff-request-reason">Approval request reason</Label><Textarea id="writeoff-request-reason" required maxLength={2000} value={draft.requestReason??""} onChange={e=>set("requestReason",e.target.value)}/></div>
        <div className="space-y-2"><Label htmlFor="writeoff-proceeds">Actual proceeds (major currency; 0 if none)</Label><Input id="writeoff-proceeds" inputMode="decimal" required value={draft.proceeds??""} onChange={e=>set("proceeds",e.target.value)}/></div>
        {receiptAllowed&&draft.proceeds.trim()&&!/^0(?:\.0{1,2})?$/.test(draft.proceeds.trim())&&<>
          <div className="space-y-2"><Label htmlFor="writeoff-receipt-date">Actual receipt date</Label><Input id="writeoff-receipt-date" type="date" required value={draft.receiptDate??""} onChange={e=>set("receiptDate",e.target.value)}/></div>
          <div className="space-y-2"><Label htmlFor="writeoff-receipt-method">Actual receipt method</Label><select id="writeoff-receipt-method" className="h-11 w-full rounded-md border bg-background px-3" value={draft.receiptMethod} onChange={e=>set("receiptMethod",e.target.value)}><option>BANK_TRANSFER</option><option>CASH</option></select></div>
          {referenceAllowed&&<div className="space-y-2"><Label htmlFor="writeoff-reference">Receipt reference (optional)</Label><Input id="writeoff-reference" maxLength={200} value={draft.reference??""} onChange={e=>set("reference",e.target.value)}/></div>}
        </>}
        {!receiptAllowed&&<p>Positive proceeds require additional actual receipt field permissions. Zero creates no cash row.</p>}
      </fieldset>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending||stale}>{pending?"Submitting…":body?"Retry identical request":"Submit approval request"}</Button><Button type="button" variant="outline" disabled={pending||!!body} onClick={()=>setOpen(false)}>Dismiss unsaved form</Button></div>
      {body&&!stale&&<p>Receipt outcome may be unknown. The original envelope/key is retained; retry it without changing inputs.</p>}
      {stale&&<div className="space-y-3"><p>Source changed. Your draft is retained; reload and explicitly reconfirm before creating a new intent.</p><Button type="button" variant="outline" onClick={async()=>{try{const r=await privateRequest<{data:Cycle}>(`/api/v1/queries/purchase?cycleId=${snapshot.id}`);setLatest(r.data)}catch(e){problem(errorText(e))}}}>Reload current cycle</Button>{latest&&<><p>Current status {latest.status??"Unavailable"}; revision {latest.revision??"Unavailable"}; basis {money(latest.financial?.basis)}.</p><Button type="button" disabled={!latest.nextActions?.includes("requestApproval")} onClick={()=>{setSnapshot(latest);setStale(false);setBody(null);setLatest(null);problem("Current source explicitly confirmed. Next submission will use a new key.")}}>Confirm current source and new request</Button></>}</div>}
    </form>}
  </section>
}

export function DisposalHistory({cycle}:{cycle:Cycle}) {
  const disposal=cycle.disposal
  if(!disposal)return null
  const basis=cycle.basisVersions?.find(b=>b.id===disposal.basisVersionId)?.total
  const loss=basis!==undefined&&disposal.proceeds!==undefined?BigInt(basis)-BigInt(disposal.proceeds):null
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Current disposal evidence"><h3 className="font-semibold">Committed current disposal</h3><dl className="grid gap-3 sm:grid-cols-2">{[["Date",disposal.date],["Reason",disposal.reason],["Method",disposal.method],["Proceeds",money(disposal.proceeds)],["Frozen basis",money(basis)],[loss!==null&&loss<0n?"Disposal gain":"Net loss",loss===null?"Unavailable":major(loss<0n?-loss:loss)],["Reviewer",disposal.approval?.kind==="CURRENT"?disposal.approval.reviewerName:undefined],["Reviewed at",disposal.approval?.kind==="CURRENT"?disposal.approval.reviewedAt:undefined],["Closed at",cycle.closedAt]].map(([label,value])=><div key={String(label)}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value??"Unavailable"}</dd></div>)}</dl>{disposal.approval?.kind==="CURRENT"&&disposal.approval.approvalId&&<Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/approvals/${disposal.approval.approvalId}`}>Approval provenance</Link>}<h4 className="font-medium">Actual proceeds receipts</h4>{disposal.payments===undefined?<p>Receipt facts unavailable</p>:disposal.payments.length?disposal.payments.map(p=><p key={p.id} className="break-words">{p.direction} {money(p.amount)} · {p.date??"Unavailable"} · {p.method??"Unavailable"} · {p.reference}<br/>Owner {p.owner?.type} {p.owner?.id}<br/>Payment {p.id} · Command {p.commandId}</p>):<p>No payment fact (zero proceeds).</p>}</section>
}

export function ApprovalsList(){
  const [status,setStatus]=useState(""),[page,setPage]=useState(1)
  const query=useQuery({queryKey:["approvals",status,page],retry:false,queryFn:()=>privateRequest<{data:{data:Approval[];total:number}}>(`/api/v1/queries/approvals?page=${page}&pageSize=20${status?`&status=${status}`:""}`)})
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Approvals</h1><p>Version-bound write-off requests. Other approval kinds remain pending their real domain workflows.</p><Label htmlFor="approval-status">Status</Label><select id="approval-status" className="h-11 rounded-md border bg-background px-3" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">All</option>{["PENDING","APPROVED","REJECTED","STALE"].map(s=><option key={s}>{s}</option>)}</select>{query.isPending&&<p role="status">Loading saved requests…</p>}{query.isError&&<p role="alert">Inbox unavailable: {errorText(query.error)} <Button variant="outline" onClick={()=>void query.refetch()}>Retry inbox</Button></p>}{query.data&&<><p>{query.data.data.total} authorized requests</p><ul className="space-y-3">{query.data.data.data.map(a=><li key={a.id} className="rounded-lg border p-4"><Link prefetch={false} className="inline-flex min-h-11 items-center break-all underline" href={`/approvals/${a.id}`}>{a.id}</Link><p>{a.state??"Unavailable"} · {a.requestedAt??"Time unavailable"}</p><p className="whitespace-pre-wrap break-words">{a.reason??"Reason unavailable"}</p></li>)}</ul>{query.data.data.total===0&&<p>No visible requests.</p>}<div className="flex gap-3"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><Button variant="outline" disabled={page*20>=query.data.data.total} onClick={()=>setPage(p=>p+1)}>Next</Button></div></>}</section>
}

export function ApprovalDetail({approval:a,cycle,canReview}:{approval:Approval;cycle:Cycle;canReview:boolean}){
  const {actor}=useActor(),router=useRouter(),queries=useQueryClient()
  const [decision,setDecision]=useState<"APPROVE"|"REJECT">("APPROVE"),[note,setNote]=useState(""),[body,setBody]=useState<string|null>(null),[pending,setPending]=useState(false),[stale,setStale]=useState(false),[message,setMessage]=useState("")
  const alert=useRef<HTMLParagraphElement>(null)
  function problem(text:string){setMessage(text);requestAnimationFrame(()=>alert.current?.focus())}
  async function submit(event:React.FormEvent){event.preventDefault();if(pending||stale)return;setPending(true)
    try{
      let submitted=body
      if(!submitted){
        const dependencies=a.expected?.filter((r):r is Dependency=>!!r.type&&!!r.id&&!!r.revision)
        if(!a.id||!a.revision||!dependencies||dependencies.length!==2)throw Error("Readable exact saved dependencies required")
        const parsed=approvalEnvelope("reviewApproval").safeParse({schemaVersion:1,idempotencyKey:crypto.randomUUID(),expected:[{type:"ApprovalRequest",id:a.id,revision:a.revision},...dependencies],input:{approvalId:a.id,decision,...(note.trim()?{note}:{})}})
        if(!parsed.success)throw Error("Rejection requires a nonblank review note")
        submitted=JSON.stringify(parsed.data);setBody(submitted)
      }
      const result=await privateRequest<Applied>("/api/v1/commands/reviewApproval",{method:"POST",headers:{"Content-Type":"application/json"},body:submitted})
      setBody(null);problem(`Review committed once. Command ${result.commandId}.`)
      for(const key of result.invalidate)void queries.invalidateQueries({queryKey:[key]})
      router.refresh()
    }catch(e){const code=errorText(e);setStale(staleCodes.includes(code));if(e instanceof RequestError&&e.status===422)setBody(null);problem(code)}finally{setPending(false)}}
  const input=a.proposal?.kind==="WRITE_OFF"?a.proposal.input:undefined
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Saved write-off request</h1><dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">{[["Request",a.id],["State",a.state],["Requester",a.requestedBy],["Requested at",a.requestedAt],["Approval request reason",a.reason],["Disposal reason",input?.reason],["Disposal date",input?.date],["Method",input?.method],["Proposed proceeds",money(input?.proceeds)],["Actual receipt date",input?.receipt?.date],["Actual receipt method",input?.receipt?.method],["Receipt reference",input?.receipt?.reference],["Reviewer",a.reviewedBy],["Reviewed at",a.reviewedAt],["Review note",a.reviewNote],["Applied command",a.appliedCommandId]].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value??"Unavailable or not recorded"}</dd></div>)}</dl><p>Current cycle: {cycle.status??"Unavailable"}; revision {cycle.revision??"Unavailable"}; persisted basis {money(cycle.financial?.basis)}.</p>{cycle.id&&<Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={`/purchases/${cycle.id}`}>Owning purchase cycle</Link>}<h2 className="font-semibold">Immutable saved dependencies</h2><ul>{a.expected?.map(r=><li key={`${r.type}:${r.id}`} className="break-words">{r.type} {r.id} · revision {r.revision}</li>)??<li>Unavailable</li>}</ul>{a.state==="PENDING"&&<p>No write-off or cash effect has been applied. There is no persisted withdrawal command.</p>}{message&&<p role="alert" ref={alert} tabIndex={-1} className="break-words">{message}</p>}{a.requestedBy===actor.user.id&&<p>A separate authorized reviewer is required. Self-review is forbidden, including Administrator.</p>}{(canReview||body)&&a.requestedBy!==actor.user.id&&<form onSubmit={submit} className="space-y-4"><fieldset disabled={pending||stale||!!body} className="space-y-3"><Label htmlFor="review-decision">Decision</Label><select id="review-decision" className="h-11 rounded-md border bg-background px-3" value={decision} onChange={e=>setDecision(e.target.value as "APPROVE"|"REJECT")}><option>APPROVE</option><option>REJECT</option></select><Label htmlFor="review-note">Review note (required for rejection)</Label><Textarea id="review-note" maxLength={2000} required={decision==="REJECT"} value={note} onChange={e=>setNote(e.target.value)}/></fieldset><Button disabled={pending||stale} type="submit">{pending?"Submitting…":body?"Retry identical review":"Commit review"}</Button>{body&&!stale&&<p>Original review envelope/key retained while its outcome is unknown. Retry without editing.</p>}</form>}{!canReview&&!body&&a.requestedBy!==actor.user.id&&a.state==="PENDING"&&<p>Review unavailable under current source state, saved dependencies or current record/field authority. Reload or make a fresh proposal; no silent reconfirmation.</p>}{stale&&<p>Your note is retained. This stale intent cannot execute. Reload the source and use a fresh proposal where required.</p>}<Button variant="outline" onClick={()=>router.refresh()}>Reload current request</Button><DisposalHistory cycle={cycle}/></section>
}
