-- CreateTable
CREATE TABLE "Domain" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" DATETIME,
    "httpStatus" INTEGER,
    "httpsRedirect" BOOLEAN,
    "ipAddress" TEXT,
    "sslValid" BOOLEAN,
    "sslExpiry" DATETIME,
    "sslIssuer" TEXT,
    "sslDaysLeft" INTEGER,
    "hasHsts" BOOLEAN,
    "hasCsp" BOOLEAN,
    "hasXFrame" BOOLEAN,
    "hasXContent" BOOLEAN,
    "hasRp" BOOLEAN
);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_domain_key" ON "Domain"("domain");
