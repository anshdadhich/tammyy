import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import { listAdminEmployers, type AdminEmployer } from "@/lib/admin-employers";
import { readNavViewer } from "@/lib/hr-session";
import AdminEmployers from "./admin-employers";

export default async function AdminPage() {
  const viewer = await readNavViewer();
  if (!viewer?.isAdmin) notFound();

  let initialEmployers: AdminEmployer[] = [];
  try {
    initialEmployers = await listAdminEmployers("pending");
  } catch {
    console.error("[admin] initial employer list failed");
  }

  return (
    <PageShell variant="landing" active="/#candidates" viewer={viewer}>
      <section className="pt-20 lg:pt-28 pb-24">
        <div className="max-w-[1160px] mx-auto px-6">
          <p className="meta-chip">Admin</p>
          <h1 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold tracking-[-0.03em] leading-[1.06] text-ink mt-4">
            Employer verification
          </h1>
          <p className="text-[16px] text-body mt-2 max-w-[52ch]">
            Companies await approval here, oldest first. Verified employers unlock search.
          </p>
          <div className="mt-8">
            <AdminEmployers initialEmployers={initialEmployers} />
          </div>
        </div>
      </section>
    </PageShell>
  );
}
