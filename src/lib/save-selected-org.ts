"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORG_COOKIE, PERSONAL_ORG } from "@/lib/org-constants";

const ORG_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export async function saveSelectedOrg(org: string | null): Promise<void> {
  const session = await auth();
  const login = session?.githubLogin;
  if (!login) return;

  const value = org ?? "";
  if (value && value !== PERSONAL_ORG && !ORG_RE.test(value)) {
    throw new Error("Organisation invalide");
  }

  await db.userPref.upsert({
    where: { githubLogin: login },
    create: { githubLogin: login, selectedOrg: value },
    update: { selectedOrg: value },
  });

  const store = await cookies();
  store.set(ORG_COOKIE, value, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    httpOnly: true,
  });
}
