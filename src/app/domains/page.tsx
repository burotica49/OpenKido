import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listDomains } from "@/lib/domain-check";
import { DomainsClient } from "./domains-client";

export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const domains = await listDomains();
  return <DomainsClient domains={domains} />;
}
