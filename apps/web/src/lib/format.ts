export function formatUsdc(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function formatContracts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function formatOutcomePrice(price: number): string {
  return price.toFixed(2);
}

export function truncateAddress(addr: string, left = 4, right = 4): string {
  if (addr.length <= left + right + 1) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}
