import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import { readHrSession } from "@/lib/hr-session";
import SearchClient from "./search-client";

export const metadata: Metadata = {
  title: "Search talent",
  description:
    "Describe the target role in plain English - requirements are parsed automatically and matched against verified candidates.",
};

export default async function HireSearchPage() {
  const hr = await readHrSession();
  if (!hr || (hr.employerStatus === "none" && !hr.isAdmin)) redirect("/hire/login");
  return (
    <PageShell
      variant="hire"
      active="/hire"
      viewer={{ kind: "hr", email: hr.email, name: hr.name, isAdmin: hr.isAdmin }}
    >
      <SearchClient
        session={{ email: hr.email, name: hr.name, employerStatus: hr.employerStatus }}
      />
    </PageShell>
  );
}
