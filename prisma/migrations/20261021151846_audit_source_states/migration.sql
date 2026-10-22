-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RepoAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "csTotal" INTEGER NOT NULL DEFAULT 0,
    "csCritical" INTEGER NOT NULL DEFAULT 0,
    "csHigh" INTEGER NOT NULL DEFAULT 0,
    "csMedium" INTEGER NOT NULL DEFAULT 0,
    "csLow" INTEGER NOT NULL DEFAULT 0,
    "dbTotal" INTEGER NOT NULL DEFAULT 0,
    "dbCritical" INTEGER NOT NULL DEFAULT 0,
    "dbHigh" INTEGER NOT NULL DEFAULT 0,
    "dbMedium" INTEGER NOT NULL DEFAULT 0,
    "dbLow" INTEGER NOT NULL DEFAULT 0,
    "ssTotal" INTEGER NOT NULL DEFAULT 0,
    "ssActive" INTEGER NOT NULL DEFAULT 0,
    "alerts" TEXT NOT NULL,
    "csState" TEXT NOT NULL DEFAULT 'unknown',
    "dbState" TEXT NOT NULL DEFAULT 'unknown',
    "ssState" TEXT NOT NULL DEFAULT 'unknown'
);
INSERT INTO "new_RepoAudit" ("alerts", "checkedAt", "csCritical", "csHigh", "csLow", "csMedium", "csTotal", "dbCritical", "dbHigh", "dbLow", "dbMedium", "dbTotal", "id", "owner", "repo", "ssActive", "ssTotal") SELECT "alerts", "checkedAt", "csCritical", "csHigh", "csLow", "csMedium", "csTotal", "dbCritical", "dbHigh", "dbLow", "dbMedium", "dbTotal", "id", "owner", "repo", "ssActive", "ssTotal" FROM "RepoAudit";
DROP TABLE "RepoAudit";
ALTER TABLE "new_RepoAudit" RENAME TO "RepoAudit";
CREATE UNIQUE INDEX "RepoAudit_owner_repo_key" ON "RepoAudit"("owner", "repo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
