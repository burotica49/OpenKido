-- CreateTable
CREATE TABLE "IssueState" (
    "githubLogin" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "until" DATETIME,
    "assignee" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("githubLogin", "key")
);

-- CreateIndex
CREATE INDEX "IssueState_githubLogin_status_idx" ON "IssueState"("githubLogin", "status");
