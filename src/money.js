export function toCents(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return cents / 100;
}

export function formatUSD(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount));
}

export function paypalAmount(dollars) {
  return (Math.round(Number(dollars) * 100) / 100).toFixed(2);
}
