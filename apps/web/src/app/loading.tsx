export default function Loading() {
  return (
    <div className="container">
      <div className="skeleton" style={{ height: 28, width: 180, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 120 }} />
    </div>
  );
}
