/**
 * Market settle status labels — shared by SSR indexer + client UI.
 * Keep free of "use client" so RSC GPA mapping can import it.
 */
export function settleStatusLabel(
  status: number,
): "open" | "settling" | "settled-yes" | "settled-no" | "void" {
  switch (status) {
    case 1:
      return "settling";
    case 2:
      return "settled-yes";
    case 3:
      return "settled-no";
    case 4:
      return "void";
    default:
      return "open";
  }
}
