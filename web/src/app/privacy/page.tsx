import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How Tammy collects, uses, and protects candidate and employer data.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink mt-9">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <PageShell variant="landing" footer>
      <section className="pt-20 lg:pt-28 pb-16">
        <div className="max-w-[760px] mx-auto px-6">
          <p className="text-[13px] font-mono uppercase tracking-[0.12em] text-muted">Legal</p>
          <h1 className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-semibold tracking-[-0.03em] leading-[1.08] text-ink">
            Privacy policy
          </h1>
          <p className="mt-4 text-[15px] text-body leading-[1.7]">
            Last updated 4 October 2026. This policy explains what data Tammy
            (“we”, “the platform”) collects from candidates and
            employers, why we collect it, and the choices you have.
          </p>

          <H>What we collect</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            <strong>Candidates</strong> provide their profile: name, email, phone,
            location, work history, projects, education, skills, salary
            expectations, links (GitHub, LinkedIn, portfolio), and optionally a
            resume and photo. <strong>Employers</strong> provide company details
            (name, website, LinkedIn) and account credentials. Both sides have
            authentication records (a hashed password and session tokens) and we
            log search activity, shortlists, and contact events for safety and
            audit purposes.
          </p>

          <H>How visibility works</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Candidates control exposure field by field. Contact details (email,
            phone), resume, photo, and portfolio links are only shown to
            recruiters when the candidate switches the corresponding
            “show” setting on, and profiles can be hidden or
            unpublished at any time. Search results are ranked by fit for the
            employer’s stated role; we do not sell profile data and we do
            not run paid promotion inside results.
          </p>

          <H>AI processing</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Profile summaries, project depth analysis, and search scoring are
            produced by automated models from the profile data a candidate
            writes. These are decision-support aids for recruiters, not
            automated hiring decisions; a human always decides whom to contact.
            Candidate data is used only to generate that candidate’s own
            summary and scores — it is not used to train third-party models.
          </p>

          <H>Who can see what</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Verified employer accounts can browse visible profiles and, where a
            candidate has opted in, contact them. Contact attempts are logged
            (who contacted whom, when) so disputes can be reviewed. Candidates
            can see their own audit trail. Platform administrators can access
            data only for support, abuse investigation, and verification
            review.
          </p>

          <H>Storage and retention</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Data is stored on Cloudflare infrastructure (D1 database, Vectorize
            search index, and R2 file storage when enabled). Sessions expire
            after 30 days. When a candidate deletes their profile, their profile
            rows, derived analysis, search index entries, and files are removed;
            minimal financial and abuse-prevention records may be retained where
            the law requires it.
          </p>

          <H>Your rights and choices</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            You can edit or hide your profile at any time, delete your profile
            and account data, and request a copy of your data or its correction
            by contacting us. If you are in the EU/UK or another region with data
            protection law, you also have the rights that law grants you
            (access, rectification, erasure, portability, objection) — contact
            us to exercise any of them.
          </p>

          <H>Cookies</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            We use one strictly necessary cookie, <code className="text-[13px]">tammy_session</code>,
            to keep you signed in. We do not use advertising or cross-site
            tracking cookies.
          </p>

          <H>Children</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Tammy is for professional hiring and is not directed at children
            under 16. We do not knowingly collect their data.
          </p>

          <H>Changes and contact</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            If this policy changes materially, we will update the date above and
            notify signed-in users where appropriate. Questions, data requests,
            or complaints: email us at the address shown on your account
            settings page — every message reaches the operator directly.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
