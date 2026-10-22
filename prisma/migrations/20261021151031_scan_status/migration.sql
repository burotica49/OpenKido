-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RepoScan" (
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
    "components" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "note" TEXT
);
INSERT INTO "new_RepoScan" ("branch", "components", "critical", "high", "id", "low", "medium", "owner", "repo", "scannedAt", "total", "vulnerable") SELECT "branch", "components", "critical", "high", "id", "low", "medium", "owner", "repo", "scannedAt", "total", "vulnerable" FROM "RepoScan";
DROP TABLE "RepoScan";
ALTER TABLE "new_RepoScan" RENAME TO "RepoScan";
CREATE INDEX "RepoScan_owner_repo_idx" ON "RepoScan"("owner", "repo");
CREATE UNIQUE INDEX "RepoScan_owner_repo_key" ON "RepoScan"("owner", "repo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
