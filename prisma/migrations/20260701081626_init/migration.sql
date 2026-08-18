-- CreateTable
CREATE TABLE "RepoScan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" INTEGER NOT NULL,
    "vulnerable" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "high" INTEGER NOT NULL,
    "medium" INTEGER NOT NULL,
    "low" INTEGER NOT NULL,
    "components" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "RepoScan_owner_repo_idx" ON "RepoScan"("owner", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "RepoScan_owner_repo_key" ON "RepoScan"("owner", "repo");
