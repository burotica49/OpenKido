-- CreateTable
CREATE TABLE "RepoSecrets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'complete',
    "filesScanned" INTEGER NOT NULL,
    "filesSkipped" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "high" INTEGER NOT NULL,
    "medium" INTEGER NOT NULL,
    "low" INTEGER NOT NULL,
    "findings" TEXT NOT NULL,
    "note" TEXT
);

-- CreateTable
CREATE TABLE "PackageLicense" (
    "ecosystem" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("ecosystem", "name", "version")
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoSecrets_owner_repo_key" ON "RepoSecrets"("owner", "repo");
