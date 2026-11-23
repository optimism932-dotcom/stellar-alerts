CREATE TABLE "ContractAbiRegistry" (
  "contractId" TEXT NOT NULL,
  "wasmHash" TEXT NOT NULL,
  "abi" JSONB NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractAbiRegistry_pkey" PRIMARY KEY ("contractId")
);

CREATE INDEX "ContractAbiRegistry_wasmHash_idx" ON "ContractAbiRegistry"("wasmHash");
CREATE INDEX "ContractAbiRegistry_extractedAt_idx" ON "ContractAbiRegistry"("extractedAt");
