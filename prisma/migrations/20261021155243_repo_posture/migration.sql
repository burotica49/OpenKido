-- CreateTable
CREATE TABLE "RepoPosture" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "evaluated" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "warning" INTEGER NOT NULL,
    "unknown" INTEGER NOT NULL,
    "failCritical" INTEGER NOT NULL,
    "failHigh" INTEGER NOT NULL,
    "failMedium" INTEGER NOT NULL,
    "failLow" INTEGER NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "results" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoPosture_owner_repo_key" ON "RepoPosture"("owner", "repo");
