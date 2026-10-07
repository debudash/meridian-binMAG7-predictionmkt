import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container" style={{ textAlign: "center", padding: "4rem 1rem" }}>
      <h1>Market not found</h1>
      <p className="muted">The page or market you requested does not exist.</p>
      <Link className="btn btn-primary" href="/markets">
        Browse markets
      </Link>
    </div>
  );
}
