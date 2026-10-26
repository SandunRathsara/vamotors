-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "vamotors";

-- CreateEnum
CREATE TYPE "vamotors"."VehicleStatus" AS ENUM ('PURCHASED', 'IN_STOCK', 'IN_REPAIR', 'ADVANCE_PLACED', 'ADVANCE_EXPIRED', 'FINANCE_PENDING', 'DO_RECEIVED', 'DELIVERED', 'SOLD', 'WRITTEN_OFF');

-- CreateTable
CREATE TABLE "vamotors"."user" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "authzRevision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."session" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" UUID NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."account" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."verification" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Environment" (
    "singleton" INTEGER NOT NULL DEFAULT 1,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "allowBusinessWrites" BOOLEAN NOT NULL DEFAULT false,
    "disposableTest" BOOLEAN NOT NULL DEFAULT false,
    "bootstrappedAt" TIMESTAMP(3),
    "bootstrapTokenHash" TEXT,
    "bootstrapExpiresAt" TIMESTAMP(3),

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("singleton")
);

-- CreateTable
CREATE TABLE "vamotors"."AdminGuard" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "generation" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AdminGuard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "systemKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Permission" (
    "id" UUID NOT NULL,
    "ruleHash" TEXT NOT NULL,
    "rule" JSONB NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "vamotors"."UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedBy" UUID NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "vamotors"."BusinessSequence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "BusinessSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."CommandReceipt" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "actorKey" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "inputHash" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "result" JSONB NOT NULL,
    "businessSequence" BIGINT,

    CONSTRAINT "CommandReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."EntityReadVersion" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "sequence" BIGINT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "tombstone" BOOLEAN NOT NULL DEFAULT false,
    "commandId" UUID NOT NULL,

    CONSTRAINT "EntityReadVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."AuditEntry" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "commandId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "userId" UUID,
    "systemScope" TEXT,
    "initiatedBy" UUID,
    "approverId" UUID,
    "reason" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fieldDiff" JSONB NOT NULL,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Notification" (
    "id" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Customer" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "callingName" TEXT NOT NULL,
    "nicOrPassport" TEXT NOT NULL,
    "normalizedIdentity" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "drivingLicence" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "nicOrRegNumber" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "hotline" TEXT,
    "notes" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."SupplierContact" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."Vehicle" (
    "id" UUID NOT NULL,
    "engineNumber" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "normalizedEngine" TEXT NOT NULL,
    "normalizedChassis" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "fuelType" TEXT NOT NULL,
    "transmission" TEXT NOT NULL,
    "vin" TEXT,
    "crNumber" TEXT,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activePurchaseId" UUID,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."PurchaseRecord" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "purchaseType" TEXT NOT NULL,
    "acquisitionKind" TEXT NOT NULL,
    "supplierId" UUID,
    "sellerCustomerId" UUID,
    "purchaseDate" DATE NOT NULL,
    "purchasePrice" BIGINT NOT NULL,
    "listedPrice" BIGINT,
    "status" "vamotors"."VehicleStatus" NOT NULL DEFAULT 'PURCHASED',
    "available" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "receivedDate" DATE,
    "closedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."StatusEvent" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "from" "vamotors"."VehicleStatus",
    "to" "vamotors"."VehicleStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "commandId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "vamotors"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "vamotors"."session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "vamotors"."session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "vamotors"."account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "vamotors"."account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "vamotors"."verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_id_key" ON "vamotors"."Environment"("id");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "vamotors"."Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_systemKey_key" ON "vamotors"."Role"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_ruleHash_key" ON "vamotors"."Permission"("ruleHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_businessSequence_key" ON "vamotors"."CommandReceipt"("businessSequence");

-- CreateIndex
CREATE UNIQUE INDEX "CommandReceipt_environmentId_actorKey_commandName_idempoten_key" ON "vamotors"."CommandReceipt"("environmentId", "actorKey", "commandName", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EntityReadVersion_entityType_entityId_sequence_idx" ON "vamotors"."EntityReadVersion"("entityType", "entityId", "sequence" DESC);

-- CreateIndex
CREATE INDEX "EntityReadVersion_sequence_idx" ON "vamotors"."EntityReadVersion"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EntityReadVersion_entityType_entityId_sequence_key" ON "vamotors"."EntityReadVersion"("entityType", "entityId", "sequence");

-- CreateIndex
CREATE INDEX "AuditEntry_entityType_entityId_recordedAt_id_idx" ON "vamotors"."AuditEntry"("entityType", "entityId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "AuditEntry_userId_recordedAt_id_idx" ON "vamotors"."AuditEntry"("userId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "AuditEntry_commandId_idx" ON "vamotors"."AuditEntry"("commandId");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_id_idx" ON "vamotors"."Notification"("recipientUserId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientUserId_eventKey_key" ON "vamotors"."Notification"("recipientUserId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_normalizedIdentity_key" ON "vamotors"."Customer"("normalizedIdentity");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "vamotors"."Customer"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_activePurchaseId_key" ON "vamotors"."Vehicle"("activePurchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_normalizedEngine_normalizedChassis_key" ON "vamotors"."Vehicle"("normalizedEngine", "normalizedChassis");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_activePurchaseId_id_key" ON "vamotors"."Vehicle"("activePurchaseId", "id");

-- CreateIndex
CREATE INDEX "PurchaseRecord_status_available_purchaseDate_id_idx" ON "vamotors"."PurchaseRecord"("status", "available", "purchaseDate", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRecord_id_vehicleId_key" ON "vamotors"."PurchaseRecord"("id", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRecord_vehicleId_cycleNumber_key" ON "vamotors"."PurchaseRecord"("vehicleId", "cycleNumber");

-- CreateIndex
CREATE INDEX "StatusEvent_cycleId_recordedAt_id_idx" ON "vamotors"."StatusEvent"("cycleId", "recordedAt", "id");

-- AddForeignKey
ALTER TABLE "vamotors"."session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vamotors"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vamotors"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "vamotors"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "vamotors"."Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "vamotors"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "vamotors"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."UserRole" ADD CONSTRAINT "UserRole_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "vamotors"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."EntityReadVersion" ADD CONSTRAINT "EntityReadVersion_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."AuditEntry" ADD CONSTRAINT "AuditEntry_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "vamotors"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "vamotors"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."Vehicle" ADD CONSTRAINT "Vehicle_activePurchaseId_id_fkey" FOREIGN KEY ("activePurchaseId", "id") REFERENCES "vamotors"."PurchaseRecord"("id", "vehicleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vamotors"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "vamotors"."Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."PurchaseRecord" ADD CONSTRAINT "PurchaseRecord_sellerCustomerId_fkey" FOREIGN KEY ("sellerCustomerId") REFERENCES "vamotors"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."StatusEvent" ADD CONSTRAINT "StatusEvent_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "vamotors"."PurchaseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."StatusEvent" ADD CONSTRAINT "StatusEvent_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "vamotors"."CommandReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
