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
    // proxy-addr matches an IPv4-mapped range against every IPv4 peer, so
    // `::ffff:0.0.0.0/96` would trust the whole IPv4 internet. Plain IPv4
    // says the same thing without the trap.
    if (family === 6 && /^(?:0{0,4}:){0,5}:?ffff:/i.test(address)) {
      throw new Error(`TRUST_PROXY_CIDRS: write "${entry}" as an IPv4 address or CIDR — an IPv4-mapped IPv6 range is matched against every IPv4 peer`);
    }
  }
  return [...new Set(entries)];
}
