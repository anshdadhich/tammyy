import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement governing use of the Tammy hiring platform.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink mt-9">{children}</h2>;
}

export default function TermsPage() {
  return (
    <PageShell variant="landing" footer>
      <section className="pt-20 lg:pt-28 pb-16">
        <div className="max-w-[760px] mx-auto px-6">
          <p className="text-[13px] font-mono uppercase tracking-[0.12em] text-muted">Legal</p>
          <h1 className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-semibold tracking-[-0.03em] leading-[1.08] text-ink">
            Terms of service
          </h1>
          <p className="mt-4 text-[15px] text-body leading-[1.7]">
            Last updated 4 October 2026. By creating an account or using Tammy
            (“the platform”, “we”), you agree to these terms.
          </p>

          <H>What Tammy is</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            A matching platform: candidates publish an evidence-backed
            professional profile once; employers search those profiles using
            semantic matching and contact candidates they choose to pursue. We
            are not a recruitment agency, employer, or guarantor of any hire.
          </p>

          <H>Your account</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Provide accurate information, keep your credentials secure, and one
            account per person or company. Candidate profiles must describe real
            people and real work; employers must represent their actual company.
            We may suspend accounts that impersonate, spam, scrape, or misuse the
            platform.
          </p>

          <H>Candidate content</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            You own what you write and upload. You grant us a non-exclusive
            license to display it to signed-in, verified employers according to
            your visibility settings, and to derive summaries and scores from it
            (see the Privacy policy). You can delete your profile at any time,
            ending that license prospectively.
          </p>

          <H>Employer use</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Use candidate data only for evaluating that candidate for roles you
            are actually hiring for. Do not export, resell, bulk-download, or
            repurpose profiles, and do not contact candidates with unrelated
            offers. Contact attempts are logged. Verified status can be revoked
            for abuse.
          </p>

          <H>Subscriptions, payments, and refunds</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Candidate use is free. Employers subscribe monthly (Free, Basic, Pro)
            for a stated search quota; subscriptions do not renew automatically
            unless an auto-renew mandate is explicitly authorized, and quotas
            reset monthly. Pricing is shown before purchase. Refunds follow the
            Refund policy linked in the footer, which forms part of these terms.
            Fees exclude applicable taxes (GST is added where required).
          </p>

          <H>Fair use</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Search quotas protect platform quality. Automated or scripted use,
            account sharing to multiply quotas, and deliberate circumvention of
            limits are not allowed and may result in throttling or suspension.
          </p>

          <H>AI-assisted output</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Summaries, match scores, and interview questions are generated with
            AI from profile content. They are provided as decision support and
            may contain errors; you are responsible for your own hiring
            decisions and for complying with employment law in your
            jurisdiction. We do not make automated rejection or hiring decisions
            on employers’ behalf.
          </p>

          <H>Service availability</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            The platform is provided “as is” and may change or be
            interrupted for maintenance. We keep a persistent service for normal
            use but make no uptime warranty at this stage; material changes to
            paying plans are announced in advance.
          </p>

          <H>Limitation of liability</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            To the maximum extent permitted by law, our liability for any claim
            arising from the platform is limited to the fees you paid us in the
            three months before the claim. We are not liable for indirect,
            incidental, or consequential damages, or for the conduct of users.
            Nothing in these terms excludes liability that cannot lawfully be
            excluded.
          </p>

          <H>Termination</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            You may stop using Tammy and delete your account at any time. We may
            suspend or terminate access for breach of these terms, with notice
            where practical. Sections that by nature should survive (content
            licenses already granted, liability limits, indemnities) survive
            termination.
          </p>

          <H>Governing law and contact</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            These terms are governed by the laws of India, without regard to
            conflict-of-law rules. Questions or disputes: contact us via the
            email shown on your account settings page and we will attempt to
            resolve things in good faith first.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
