-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL,
    "vulnerable" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "high" INTEGER NOT NULL,
    "medium" INTEGER NOT NULL,
    "low" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "ScanHistory_owner_repo_scannedAt_idx" ON "ScanHistory"("owner", "repo", "scannedAt");
