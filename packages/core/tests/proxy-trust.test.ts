import express from "express";
import { expect, test } from "vitest";
import { z } from "zod/v4";
import { trustedProxies } from "../../../example/modules/security/helpers/proxy.js";

async function inspect(trust: string, forwardedFor: string) {
  const app = express();

  app.set("trust proxy", trustedProxies(trust));

  app.get("/", (req, res) =>
    res.json({
      ip: req.ip,
      ips: req.ips,
      peer: req.socket.remoteAddress,
      protocol: req.protocol,
      hostname: req.hostname,
    }),
  );

  const server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);

    server.once("error", reject);
  });

  try {
    const address = server.address();

    if (!address || typeof address === "string") throw new Error("No listener");

    const response = await fetch("http://127.0.0.1:" + address.port, {
      headers: {
        "X-Forwarded-For": forwardedFor,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "proxy.example.test",
      },
    });

    return z
      .object({
        ip: z.string(),
        ips: z.array(z.string()),
        peer: z.string(),
        protocol: z.string(),
        hostname: z.string(),
      })
      .parse(await response.json());
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test.each(["", "198.51.100.0/24"])(
  "untrusted socket ignores forwarded IP, host and protocol: %j",
  async (trust) => {
    const result = await inspect(trust, "203.0.113.7");

    expect(result).toMatchObject({
      ip: result.peer,
      ips: [],
      protocol: "http",
      hostname: "127.0.0.1",
    });
  },
);

test("a trusted peer stops at the nearest untrusted address, ignoring a forged earlier entry", async () => {
  const result = await inspect(
    "127.0.0.1/32, ::1/128",
    "203.0.113.7, 198.51.100.9",
  );

  expect(result).toMatchObject({
    ip: "198.51.100.9",
    ips: ["198.51.100.9"],
    protocol: "https",
    hostname: "proxy.example.test",
  });
});

test("explicitly trusted intermediate proxies are traversed in the forwarded chain", async () => {
  const result = await inspect(
    "127.0.0.1/32,198.51.100.0/24",
    "203.0.113.7, 198.51.100.9",
  );

  expect(result).toMatchObject({
    ip: "203.0.113.7",
    ips: ["203.0.113.7", "198.51.100.9"],
  });
});

test("Express matches configured IPv6 peers and IPv4-mapped socket addresses", () => {
  const app = express();

  app.set("trust proxy", trustedProxies("2001:db8:1::/48,127.0.0.1"));

  const trust = app.get("trust proxy fn");

  expect(trust("2001:db8:1::1234")).toBe(true);
  expect(trust("2001:db8:2::1")).toBe(false);
  expect(trust("::ffff:127.0.0.1")).toBe(true);
});

test.each([
  "true",
  "1",
  "loopback",
  "*",
  "127.0.0.1,",
  "not-an-ip",
  "127.0.0.1/33",
  "::1/129",
  "0.0.0.0/0",
  "::/0",
  "fe80::1%eth0",
])("invalid or implicit proxy trust is rejected: %s", (value) => {
  expect(() => trustedProxies(value)).toThrow("TRUST_PROXY_CIDRS");
});
