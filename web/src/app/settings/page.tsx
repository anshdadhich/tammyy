import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import { readHrSession, readNavViewer } from "@/lib/hr-session";
import SettingsClient from "./settings-client";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your session, sign out, and switch the color theme.",
};

export default async function SettingsPage() {
  const viewer = await readNavViewer();
  if (!viewer) redirect("/");
  const hr = await readHrSession();

  return (
    <PageShell variant="landing" active="/#candidates" viewer={viewer}>
      <h1 className="sr-only">Settings</h1>
      <section className="pt-12 lg:pt-16 pb-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <SettingsClient viewer={viewer} hr={hr} />
        </div>
      </section>
    </PageShell>
  );
}
