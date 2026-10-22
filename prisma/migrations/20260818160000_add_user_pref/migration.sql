-- CreateTable
CREATE TABLE "UserPref" (
    "githubLogin" TEXT NOT NULL PRIMARY KEY,
    "selectedOrg" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
