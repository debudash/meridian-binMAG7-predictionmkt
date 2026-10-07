"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container" style={{ padding: "3rem 1rem" }}>
      <div className="card" style={{ maxWidth: 480 }}>
        <h1 style={{ marginTop: 0, fontSize: "1.2rem" }}>Something went wrong.</h1>
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {error.digest ? `Error id: ${error.digest}` : error.message}
        </p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Retry
        </button>
      </div>
    </div>
  );
}
