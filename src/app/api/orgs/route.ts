import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listOrgs } from "@/lib/github";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json([], { status: 401 });
  const orgs = await listOrgs(session.accessToken);
  return NextResponse.json(orgs);
}
