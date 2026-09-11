import { isIP } from "node:net";

/** Explicit proxy peers only: no blanket trust, hop counts or named subnet aliases. */
export function trustedProxies(raw: string): false | string[] {
  if (!raw.trim()) return false;
  const entries = raw.split(",").map(entry => entry.trim());
  for (const entry of entries) {
    const [address = "", bits, ...extra] = entry.split("/");
    const family = isIP(address);
    if (!family || address.includes("%") || extra.length ||
      (bits !== undefined && (!/^[1-9][0-9]{0,2}$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128)))) {
      throw new Error("TRUST_PROXY_CIDRS must be empty or a comma-separated list of IP addresses/CIDRs with nonzero prefix lengths");
    }
  }
  return [...new Set(entries)];
}
