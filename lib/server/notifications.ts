import "server-only"
import { randomUUID } from "node:crypto"
import type { Notification, CommandReceipt } from "@prisma/client"
import type { Applied } from "../../.planning/implementation/contracts/api"
import type { Tx } from "./db"
import { currentActor, type Authority, type Identity } from "./actor"
import { notificationEnvelope, notificationInputs, type NotificationCommand, listParams } from "./validators"
import { transaction } from "./transactions"
import { runtimeConfig } from "./config"
import { inputDigest } from "./idempotency"
import { project, readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { z } from "zod"

const labels = {
  ADVANCE_EXPIRING: "Advance approaching expiry",
  ADVANCE_EXPIRED: "Advance expired",
  REPAIR_RETURNED: "Repair returned",
  APPROVAL_REQUIRED: "Approval requested",
  APPROVAL_OUTCOME: "Approval reviewed",
} as const
function own(actor: Authority, row: Notification, action: "read" | "update") {
  if (row.recipientUserId !== actor.userId) fail("NOT_FOUND", 404)
  requireFields(actor.ability,"Notification",action,row,action==="read"?["id","revision"]:["readAt"])
}
function dto(actor: Authority, row: Notification) {
  own(actor,row,"read")
  const href = row.targetType === "ApprovalRequest" ? `/approvals/${row.targetId}` : row.targetType === "PurchaseRecord" ? `/purchases/${row.targetId}` : row.targetType === "Vehicle" ? `/vehicles/${row.targetId}` : ""
  const label=labels[row.kind as keyof typeof labels]
  if(!label||!href)fail("INTERNAL_ERROR",500)
  const projected=project(actor.ability,"Notification",{id:row.id,revision:row.revision,kind:row.kind,target:{type:row.targetType,id:row.targetId,href},createdAt:row.createdAt.toISOString(),readAt:row.readAt?.toISOString()??null,recipientUserId:row.recipientUserId})
  if(projected.kind) { projected.title=label; projected.body="Open the record to view its current authorized details." }
  projected.redactedFields=projected.redactedFields.filter(f=>f!=="recipientUserId")
  return projected
}
export async function notificationQuery(tx: Tx, actor: Authority, args: Record<string,string>) {
  const parsed=listParams.extend({unread:z.enum(["true","false"]).optional(),kind:z.enum(["ADVANCE_EXPIRING","ADVANCE_EXPIRED","REPAIR_RETURNED","APPROVAL_REQUIRED","APPROVAL_OUTCOME"]).optional(),sort:z.string().max(1000).optional(),q:z.string().max(200).optional(),from:z.string().optional(),through:z.string().optional()}).strict().safeParse(args)
  if(!parsed.success)fail("INVALID_INPUT",422)
  const input=parsed.data
  if(input.sort||input.q||input.from||input.through)fail("FIELD_FORBIDDEN",403)
  const scope=readScope(actor.grants,actor.userId,"Notification",["id","revision","createdAt",...(input.kind?["kind"]:[]),...(input.unread?["readAt"]:[])])
  const population={AND:[{recipientUserId:actor.userId},scope]}
  const where={AND:[population,...(input.kind?[{kind:input.kind}]:[]),...(input.unread?[{readAt:input.unread==="true"?null:{not:null}}]:[])]}
  const [rows,total,unreadCount]=await Promise.all([tx.notification.findMany({where,skip:(input.page-1)*input.pageSize,take:input.pageSize,orderBy:[{createdAt:"desc"},{id:"asc"}]}),tx.notification.count({where}),tx.notification.count({where:{AND:[population,{readAt:null}]}})])
  // Counting unread is itself a readAt inference; require covering field access.
  readScope(actor.grants,actor.userId,"Notification",["readAt"])
  return {ok:true,data:rows.map(r=>dto(actor,r)),total,unreadCount,page:input.page,pageSize:input.pageSize,asOf:new Date().toISOString(),redactedFields:[]}
}
export async function notificationReplay(tx: Tx, actor: Authority, prior: CommandReceipt):Promise<Applied> {
  const result=prior.result as Applied["result"]
  if(prior.commandName==="markNotificationRead") {
    const row=await tx.notification.findUnique({where:{id:result.id}})
    if(!row)fail("NOT_FOUND",404)
    own(actor,row,"read");own(actor,row,"update")
    return {ok:true,status:"APPLIED",commandId:prior.id,replayed:true,result,affected:[{type:"Notification",id:row.id,revision:row.revision}],invalidate:["notifications"]}
  }
  if(result.type!=="NotificationRead"||result.id!==actor.userId)fail("INTERNAL_ERROR",500)
  requireFields(actor.ability,"Notification","update",{recipientUserId:actor.userId},["readAt"])
  requireFields(actor.ability,"Notification","read",{recipientUserId:actor.userId},["id","revision","readAt"])
  return {ok:true,status:"APPLIED",commandId:prior.id,replayed:true,result,affected:[],invalidate:["notifications"]}
}
export async function executeNotification(identity:Identity,name:NotificationCommand,raw:unknown):Promise<Applied> {
  const parsed=notificationEnvelope(name).safeParse(raw)
  if(!parsed.success)fail("INVALID_INPUT",422)
  const envelope=parsed.data,config=runtimeConfig(),digest=inputDigest(envelope,config.BETTER_AUTH_SECRET)
  return transaction(async tx=>{
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor=await currentActor(tx,identity)
    const scope={environmentId:config.ENVIRONMENT_ID,actorKey:`USER:${actor.userId}`,commandName:name,idempotencyKey:envelope.idempotencyKey}
    const prior=await tx.commandReceipt.findUnique({where:{environmentId_actorKey_commandName_idempotencyKey:scope}})
    if(prior){const response=await notificationReplay(tx,actor,prior);if(prior.inputHash!==digest)fail("IDEMPOTENCY_MISMATCH");return response}
    const commandId=randomUUID()
    let result:Applied["result"],affected:Applied["affected"]=[]
    if(name==="markNotificationRead") {
      const input=notificationInputs.markNotificationRead.parse(envelope.input)
      const row=await tx.notification.findUnique({where:{id:input.notificationId}})
      if(!row)fail("NOT_FOUND",404)
      own(actor,row,"read");own(actor,row,"update")
      const ref=envelope.expected.find(r=>r.type==="Notification"&&r.id===row.id)
      if(!ref)fail("REVISION_REQUIRED",428)
      if(ref.revision!==row.revision)throw new CommandError("STALE_REVISION",409,false,[{type:"Notification",id:row.id,revision:row.revision}])
      const after=row.readAt?row:await tx.notification.update({where:{id:row.id},data:{readAt:new Date(),revision:{increment:1}}})
      result={type:"Notification",id:row.id,revision:after.revision};affected=[{type:"Notification",id:row.id,revision:after.revision}]
    } else {
      const input=notificationInputs.markAllNotificationsRead.parse(envelope.input)
      const through=new Date(Math.min(new Date(input.through).valueOf(),Date.now()))
      const rows=await tx.notification.findMany({where:{recipientUserId:actor.userId,readAt:null,createdAt:{lte:through}}})
      requireFields(actor.ability,"Notification","update",{recipientUserId:actor.userId},["readAt"])
      for(const row of rows){own(actor,row,"read");own(actor,row,"update");if(row.revision===2147483647)fail("REVISION_EXHAUSTED")}
      await tx.notification.updateMany({where:{id:{in:rows.map(r=>r.id)}},data:{readAt:new Date(),revision:{increment:1}}})
      result={type:"NotificationRead",id:actor.userId,revision:1};affected=rows.map(r=>({type:"Notification",id:r.id,revision:r.revision+1}))
    }
    await tx.commandReceipt.create({data:{id:commandId,...scope,inputHash:digest,result}})
    return {ok:true,status:"APPLIED",commandId,replayed:false,result,affected,invalidate:["notifications"]}
  })
}
