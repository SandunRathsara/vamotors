-- CreateTable
CREATE TABLE "vamotors"."ExportJob" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "authzFingerprint" TEXT NOT NULL,
    "scopeGuard" BOOLEAN NOT NULL,
    "cutoffSequence" BIGINT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOf" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "notice" TEXT,
    "rowCount" INTEGER NOT NULL,
    "totals" JSONB NOT NULL,
    "digest" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "renderedRows" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'RENDERING',

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vamotors"."ExportRowSnapshot" (
    "exportId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ExportRowSnapshot_pkey" PRIMARY KEY ("exportId","ordinal")
);

-- CreateTable
CREATE TABLE "vamotors"."ExportPart" (
    "id" UUID NOT NULL,
    "exportId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "firstRow" INTEGER NOT NULL,
    "lastRow" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "finalKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "ExportPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_ownerUserId_kind_snapshotAt_id_idx" ON "vamotors"."ExportJob"("ownerUserId", "kind", "snapshotAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExportPart_finalKey_key" ON "vamotors"."ExportPart"("finalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExportPart_exportId_ordinal_key" ON "vamotors"."ExportPart"("exportId", "ordinal");

-- AddForeignKey
ALTER TABLE "vamotors"."ExportRowSnapshot" ADD CONSTRAINT "ExportRowSnapshot_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "vamotors"."ExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vamotors"."ExportPart" ADD CONSTRAINT "ExportPart_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "vamotors"."ExportJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
