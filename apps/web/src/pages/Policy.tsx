import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Policy and safety information pages for the customer web app.
 */

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
      <div
        className="mt-6 space-y-4 text-sm leading-relaxed"
        style={{ color: "var(--text)" }}
      >
        {children}
      </div>
    </article>
  );
}

const LAST_UPDATED = "14 November 2026";

export function Privacy() {
  return (
    <Shell title="Privacy & data protection" updated={LAST_UPDATED}>
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
        service delivery, legal obligations, and safety traceability.
      </p>
      <p>
        <strong>Your rights:</strong> under the Nigeria Data Protection
        Regulation (NDPR) / Nigeria Data Protection Act 2023, you may request
        access to, correction of, or deletion of your personal data. Contact us
        using the details on our service channels to make a request.
      </p>
    </Shell>
  );
}

export function Safety() {
  return (
    <Shell title="LPG safety information" updated={LAST_UPDATED}>
      <p>
        Liquefied petroleum gas (LPG) is safe when cylinders, hoses, regulators, and appliances are used
        correctly. Follow these precautions and act quickly if you suspect a leak or unsafe condition.
      </p>
      <p>
        <strong>If you smell gas or suspect a leak:</strong> do not switch lights, generators, or
        electrical appliances on or off, and do not use matches, lighters, or open flames. If safe, turn
        off the cylinder valve, open doors and windows for ventilation, keep people away from the area,
        and move to fresh air.
      </p>
      <p>
        <strong>Emergency contacts (Throne of Grace Integrated Ventures):</strong>{" "}
        <a href="tel:09013198496">09013198496</a>
        {" · "}
        <a href="tel:08061265486">08061265486</a>
      </p>
      <p>
        <strong>Cylinder and appliance safety:</strong> keep cylinders upright in a well-ventilated area
        away from heat, direct sunlight, and flames. Use approved hoses/regulators, inspect for cracks,
        wear, or loose fittings, and never tamper with valves or safety devices. Refill and service
        cylinders only through authorised channels.
      </p>
      <p>
        <strong>Delivery, use, and reporting:</strong> inspect the cylinder, seal, and fittings on
        delivery before use. If you notice damage, leakage, or anything unusual, stop using it and report
        it immediately through this app or by calling the emergency contacts above. For fire or
        life-threatening danger, contact local emergency services immediately.
      </p>
    </Shell>
  );
}

export function Terms() {
  return (
    <Shell title="Terms of service" updated={LAST_UPDATED}>
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
    </Shell>
  );
}
