import { Link } from "react-router-dom";
import { Button } from "@togi/ui";

/** 404 inside the console shell — keeps the operator one click from the queue. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-mono text-sm" style={{ color: "var(--primary)" }}>
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        That page doesn&apos;t exist in the operations console. It may have been moved or the
        link may be out of date.
      </p>
      <div className="mt-6">
        <Button variant="primary">
          <Link to="/queue">Back to the queue</Link>
        </Button>
      </div>
    </div>
  );
}
