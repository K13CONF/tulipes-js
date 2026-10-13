import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { boot } from "@tulipes/core/boot";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Where this boot's logger writes and the stream reads: environment values
 * are bound once at boot, so the file logging the stream needs is on for
 * the whole file, into a directory the suite owns and empties per test.
 */
const logDir = mkdtempSync(join(tmpdir(), "tulipes-log-http-"));
const app = useTestApp({ rootDir, env: { ...testEnv(), LOG_FILE: "true", LOG_DIR: logDir }, settings: testSettings() }, { beforeAll, afterAll });
afterAll(() => rm(logDir, { recursive: true, force: true }));


const tokens = z.object({
  data: z.object({ access_token: z.string(), refresh_token: z.string() }),
});

async function post(path: string, body: unknown, token?: string) {
  return fetch(app.base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function account() {
  const credentials = {
    email: randomBytes(12).toString("hex") + "@example.test",
    password: randomBytes(24).toString("hex"),
  };

  const response = await post("/api/v1/auth/register", credentials);

  expect(response.status).toBe(201);

  const body = await response.json();

  const { user } = z
    .object({ data: z.object({ user: z.object({ id: z.string() }) }) })
    .parse(body).data;

  return { ...tokens.parse(body).data, ...credentials, userId: user.id };
}

async function get(path: string, token: string) {
  return fetch(app.base + path, { headers: { authorization: "Bearer " + token } });
}

async function sysadmin() {
  const user = await account();

  await app.handle.ctx
    .models!.get("User")
    .updateOne({ _id: user.userId }, { role: "sysadmin" });

  return user;
}

/** `run` sees the log directory empty: one test's files never serve another's stream. */
async function logFiles(run: (dir: string) => Promise<void>) {
  const empty = async () => {
    for (const entry of await readdir(logDir)) await rm(join(logDir, entry), { recursive: true, force: true });
  };
  await empty();
  try {
    await run(logDir);
  } finally {
    await empty();
  }
}

test("log streaming enforces sysadmin access and never follows linked log targets", async () => {
  const ordinary = await account();
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile, symlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const canary = randomBytes(24).toString("hex");

    await writeFile(join(dir, "private"), canary);

    await symlink(join(dir, "private"), join(dir, "app-backend.log"));

    expect(
      (await get("/api/v1/settings/logs/stream", ordinary.access_token)).status,
    ).toBe(403);

    const response = await get(
      "/api/v1/settings/logs/stream",
      user.access_token,
    );

    expect(response.status).toBe(409);
    expect((await response.text()).includes(canary)).toBe(false);
  });
});

test("log stream slots are capped per account and released on HTTP cancellation", async () => {
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await writeFile(
      join(dir, "app-backend.2026-09-10.1.log"),
      JSON.stringify({ level: 30, msg: "retained line" }) + "\n",
    );

    const first = await get("/api/v1/settings/logs/stream", user.access_token);
    const second = await get("/api/v1/settings/logs/stream", user.access_token);

    try {
      expect(first.status).toBe(200);
      expect(first.headers.get("content-type")).toContain("text/event-stream");

      const blocked = await get(
        "/api/v1/settings/logs/stream",
        user.access_token,
      );

      expect(blocked.status).toBe(429);

      expect(await blocked.json()).toMatchObject({
        errors: [{ code: "TOO_MANY_LOG_STREAMS" }],
      });
    } finally {
      await first.body?.cancel();

      await second.body?.cancel();
    }

    let reopened: Response | undefined;

    await vi.waitFor(async () => {
      const response = await get(
        "/api/v1/settings/logs/stream",
        user.access_token,
      );

      if (response.status === 200) reopened = response;

      expect(response.status).toBe(200);
    });

    try {
      const reader = reopened!.body!.getReader();
      let received = "";

      try {
        while (!received.includes("retained line")) {
          const part = await reader.read();

          if (part.done) break;

          received += new TextDecoder().decode(part.value);
        }

        expect(received).toContain("event: ready");
        expect(received).toContain("retained line");
      } finally {
        await reader.cancel();
      }
    } finally {
      if (!reopened!.body!.locked) await reopened!.body!.cancel();
    }
  });
});

test.each([
  "role removal",
  "user deletion",
  "session revocation",
  "session expiry",
  "access revocation",
  "logout",
  "password replacement",
  "refresh reuse",
])("an open log stream closes after %s", async (change) => {
  const user = await sysadmin();

  const { verify, endSession, revokeAccess } = await import(
    "../../auth/helpers/tokens.ts"
  );

  const claims = verify(app.handle.ctx, user.access_token, "access")!;

  await logFiles(async (dir) => {
    const response = await get(
      "/api/v1/settings/logs/stream?tail=0",
      user.access_token,
    );

    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";

    try {
      // Observe actual SSE delivery before changing the authority behind it.
      while (!body.includes("event: ready")) {
        const part = await reader.read();

        expect(part.done).toBe(false);

        body += decoder.decode(part.value);
      }

      if (change === "role removal") {
        await app.handle.ctx
          .models!.get("User")
          .updateOne({ _id: user.userId }, { role: "admin" });
      } else if (change === "user deletion") {
        await app.handle.ctx.models!.get("User").deleteOne({ _id: user.userId });
      } else if (change === "session revocation") {
        await endSession(app.handle.ctx, claims.sid);
      } else if (change === "session expiry") {
        await app.handle.ctx
          .models!.get("Session")
          .updateOne({ sid: claims.sid }, { expires_at: new Date(0) });
      } else if (change === "access revocation") {
        await revokeAccess(app.handle.ctx, claims);
      } else if (change === "logout") {
        expect(
          (await post("/api/v1/auth/logout", {}, user.access_token)).status,
        ).toBe(200);
      } else if (change === "password replacement") {
        const { setPassword } = await import(
          "../../auth/helpers/passwords.ts"
        );

        await setPassword(
          app.handle.ctx,
          user.userId,
          randomBytes(24).toString("hex"),
        );
      } else {
        expect(
          (
            await post("/api/v1/auth/refresh", {
              refresh_token: user.refresh_token,
            })
          ).status,
        ).toBe(200);

        expect(
          (
            await post("/api/v1/auth/refresh", {
              refresh_token: user.refresh_token,
            })
          ).status,
        ).toBe(401);
      }

      const started = performance.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          (async () => {
            for (;;) {
              const part = await reader.read();

              if (part.done) break;

              body += decoder.decode(part.value);
            }
          })(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Revoked stream stayed open")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }

      // Two-second authorization lease plus scheduling tolerance on this runner.
      expect(performance.now() - started).toBeLessThan(3000);

      const { writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");

      await writeFile(join(dir, "app-backend.log"), "after revocation\n");

      expect((await reader.read()).done).toBe(true);
      expect(body).not.toContain("after revocation");

      // A different administrator can still use the controller after closure.
      const other = await sysadmin();

      const replacement = await get(
        "/api/v1/settings/logs/stream?tail=0",
        other.access_token,
      );

      expect(replacement.status).toBe(200);

      await replacement.body?.cancel();
    } finally {
      await reader.cancel();
    }
  });
});

test("shutdown drains settings streams and a later boot owns fresh stream admission", async () => {
  const user = await sysadmin();

  await logFiles(async (dir) => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await writeFile(
      join(dir, "app-backend.log"),
      JSON.stringify({ msg: "before drain" }) + "\n",
    );

    const active = await get("/api/v1/settings/logs/stream", user.access_token);

    const idle = await get(
      "/api/v1/settings/logs/stream?tail=0",
      user.access_token,
    );

    expect(active.status).toBe(200);
    expect(idle.status).toBe(200);

    const readers = [active.body!.getReader(), idle.body!.getReader()];

    try {
      for (const [index, reader] of readers.entries()) {
        let body = "";

        do {
          const part = await reader.read();

          expect(part.done).toBe(false);

          body += new TextDecoder().decode(part.value);
        } while (!body.includes(index ? "event: ready" : "before drain"));
      }

      const stopping = app.handle.shutdown();

      expect(app.handle.shutdown()).toBe(stopping);

      await expect(stopping).resolves.toBeUndefined();

      for (const reader of readers)
        expect((await reader.read()).done).toBe(true);

      // The module is imported once, but stream admission belongs to each boot.
      const next = await boot({
        rootDir,
        appEnv: "test",
        handleSignals: false,
      });

      try {
        // LOG_FILE and LOG_DIR are still set on the process, so this boot
        // reads the same directory.
        const address = next.server!.address();

        if (!address || typeof address === "string")
          throw new Error("No listener after restart");

        const response = await fetch(
          "http://127.0.0.1:" +
            address.port +
            "/api/v1/settings/logs/stream?tail=0",
          {
            headers: { authorization: "Bearer " + user.access_token },
          },
        );

        expect(response.status).toBe(200);

        await response.body?.cancel();
      } finally {
        await next.shutdown();
      }
    } finally {
      await Promise.all(readers.map((reader) => reader.cancel()));
    }
  });
});
