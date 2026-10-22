-- CreateTable
CREATE TABLE "IssueHistory" (
    "githubLogin" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "firstSeen" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "baseline" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("githubLogin", "key")
);

-- CreateIndex
CREATE INDEX "IssueHistory_githubLogin_resolvedAt_idx" ON "IssueHistory"("githubLogin", "resolvedAt");
