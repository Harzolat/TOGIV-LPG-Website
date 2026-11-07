import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Policy pages — placeholder shells for privacy (NDPA), safety and terms.
 *
 * IMPORTANT: All wording here is a working draft. Per the approved plan,
 * safety guidance, NDPA/legal notices and retention wording MUST be
 * reviewed by qualified professionals before production. Each page carries
 * a visible review banner until sign-off; replace the draft body, then
 * remove the banner.
 */

function ReviewBanner() {
  return (
    <div
      className="mb-6 rounded-lg border px-4 py-3 text-sm"
      style={{
        borderColor: "var(--warning)",
        background: "var(--warning-surface)",
        color: "var(--warning)",
      }}
      role="note"
    >
      <strong>Draft — pending professional review.</strong> This page's final
      wording must be approved by the relevant qualified professional (safety,
      data protection / legal) before it goes live.
    </div>
  );
}

function Shell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl">
      <Link to="/" className="text-sm" style={{ color: "var(--text-muted)" }}>
        ← Back home
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
        Last updated {updated}
      </p>
      <div className="mt-6">
        <ReviewBanner />
      </div>
      <div
        className="space-y-4 text-sm leading-relaxed"
        style={{ color: "var(--text)" }}
      >
        {children}
      </div>
    </article>
  );
}

const REVIEW_DATE = "pending final review";

export function Privacy() {
  return (
    <Shell title="Privacy & data protection" updated={REVIEW_DATE}>
      <p>
        Throne of Grace Integrated Ventures collects the information needed to
        deliver the service you ask for — your phone number, the requests you
        submit, delivery addresses you provide, and records of the service
        itself (cylinders, QR registrations, claims).
      </p>
      <p>
        <strong>What we use it for:</strong> fulfilling refill and delivery
        requests, sending status updates about your requests, safety
        traceability for cylinders we service, and improving our service.
      </p>
      <p>
        <strong>What we never do:</strong> sell your personal data, or publish
        your phone number, address or request details publicly. Guest tracking
        links are private, single-purpose and can be revoked.
      </p>
      <p>
        <strong>Retention:</strong> records are kept only as long as needed for
        service delivery, legal obligations and safety traceability. Final
        retention periods are pending data-protection review.
      </p>
      <p>
        <strong>Your rights:</strong> under the Nigeria Data Protection
        Regulation (NDPR) / Nigeria Data Protection Act 2023 you may request
        access to, correction of, or deletion of your personal data. Contact us
        using the details on our service channels to make a request.
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        This draft summarizes the platform's data handling. The production
        notice must be reviewed by a qualified data-protection professional
        before launch.
      </p>
    </Shell>
  );
}

export function Safety() {
  return (
    <Shell title="LPG safety information" updated={REVIEW_DATE}>
      <p>
        Liquefied petroleum gas is safe when handled with care. These general
        points are a starting placeholder — our full safety guidance will be
        reviewed and approved by a qualified safety professional before
        launch.
      </p>
      <p>
        <strong>If you smell gas:</strong> do not switch anything on or off.
        Extinguish any flames, open doors and windows, leave the area, and call
        your emergency line once you are in open air.
      </p>
      <p>
        <strong>Cylinder basics:</strong> keep cylinders upright in a
        ventilated area away from heat sources; never tamper with the valve or
        fittings; check hoses for cracks; and have cylinders refilled only
        through authorised channels.
      </p>
      <p>
        <strong>Delivery &amp; returns:</strong> check the seal and your
        cylinder's identification when a refill arrives. If something looks
        wrong, refuse the delivery or report it immediately from this app.
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        Official emergency numbers for your area will be published here from
        verified business settings before launch. Do not rely on placeholder
        information.
      </p>
    </Shell>
  );
}

export function Terms() {
  return (
    <Shell title="Terms of service" updated={REVIEW_DATE}>
      <p>
        These terms govern your use of the Throne of Grace Integrated Ventures
        customer platform — submitting requests, tracking deliveries, and
        managing cylinders and claims.
      </p>
      <p>
        <strong>Requests:</strong> submitting a request is an order
        request/notice, not a completed contract of sale; confirmation happens
        when our team accepts it, and prices are confirmed at acceptance from
        our published price list.
      </p>
      <p>
        <strong>Accounts:</strong> you are responsible for keeping access to
        your phone number secure, since it is your sign-in. Guest tracking
        links you receive are private to you.
      </p>
      <p>
        <strong>Fair use:</strong> abuse of the platform (harassment of
        staff, fraudulent claims about cylinders, or repeated invalid
        requests) may lead to account restriction, with notice where
        possible.
      </p>
      <p>
        <strong>Claims:</strong> a claim you submit about a cylinder is a
        formal record; approval or rejection is communicated through the app,
        and decisions can be reopened when new evidence appears.
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        Final wording is pending legal review before production.
      </p>
    </Shell>
  );
}
