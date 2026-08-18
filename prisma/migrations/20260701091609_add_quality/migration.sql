-- CreateTable
CREATE TABLE "RepoQuality" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "hasCi" BOOLEAN NOT NULL,
    "hasTests" BOOLEAN NOT NULL,
    "hasLint" BOOLEAN NOT NULL,
    "hasFormat" BOOLEAN NOT NULL,
    "hasTypes" BOOLEAN NOT NULL,
    "hasReadme" BOOLEAN NOT NULL,
    "hasChangelog" BOOLEAN NOT NULL,
    "hasEditorconfig" BOOLEAN NOT NULL,
    "ciFiles" TEXT NOT NULL,
    "testFiles" TEXT NOT NULL,
    "lintFiles" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RepoQuality_owner_repo_key" ON "RepoQuality"("owner", "repo");
