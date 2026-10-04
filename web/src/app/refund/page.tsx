import type { Metadata } from "next";
import PageShell from "@/components/PageShell";

export const metadata: Metadata = {
  title: "Refund policy",
  description: "How refunds work for Tammy employer subscriptions.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-ink mt-9">{children}</h2>;
}

export default function RefundPage() {
  return (
    <PageShell variant="landing" footer>
      <section className="pt-20 lg:pt-28 pb-16">
        <div className="max-w-[760px] mx-auto px-6">
          <p className="text-[13px] font-mono uppercase tracking-[0.12em] text-muted">Legal</p>
          <h1 className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-semibold tracking-[-0.03em] leading-[1.08] text-ink">
            Refund policy
          </h1>
          <p className="mt-4 text-[15px] text-body leading-[1.7]">
            Last updated 4 October 2026. This policy applies to employer
            subscriptions (Basic, Pro). Candidate use of Tammy is free and
            involves no payments.
          </p>

          <H>Consumption-gated refund</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            You may request a full refund within <strong>7 days of purchase
            provided fewer than 10% of the plan’s monthly search quota has
            been used</strong> (e.g. fewer than 50 searches on Basic, fewer than
            200 on Pro). Once that threshold is crossed or the quota is
            exhausted, the subscription is non-refundable — the service has been
            consumed.
          </p>

          <H>How to request</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Email the address shown on your account settings page from your
            account’s email, with your company name and the invoice or
            payment reference. Approved refunds are returned to the original
            payment method within 5–7 business days.
          </p>

          <H>Renewals and cancellation</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Subscriptions do not auto-renew unless you explicitly authorize an
            auto-renew mandate. Canceling simply means not renewing: access and
            your remaining search quota run until the end of the paid period.
            Renewal payments follow the same refund terms, starting from their
            own purchase date.
          </p>

          <H>Chargebacks</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            If you dispute a charge with your bank, please contact us first —
            most issues are resolved faster that way. Platform usage logs
            (search counts and timestamps) constitute the record of service
            delivery and are submitted to the payment processor in dispute
            proceedings.
          </p>

          <H>Statutory rights</H>
          <p className="mt-2 text-[15px] text-body leading-[1.7]">
            Nothing in this policy limits refund rights that cannot be excluded
            under the consumer protection law applicable to you.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
