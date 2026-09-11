import express from "express";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, vi, beforeEach } from "vitest";
import { bindRespond } from "../src/http/respond.js";
import { errorHandler } from "../src/http/error-handler.js";
import { restartAfterResponse } from "../../../example/modules/settings/helpers/pm2.js";

const pm2 = vi.hoisted(() => ({
  connect: vi.fn(),
  list: vi.fn(),
  restart: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("pm2", () => ({ default: pm2 }));

const root = realpathSync(resolve("example"));

const inventory = () => [
  { name: "api", pm_id: 1, pid: 1001, pm2_env: { pm_cwd: root } },
  { name: "worker", pm_id: 2, pid: 1002, pm2_env: { pm_cwd: root } },
];

beforeEach(() => {
  vi.clearAllMocks();

  vi.stubEnv("PM2_HOME", "/tmp/tulipes-response-test");
  vi.stubEnv("pm_id", "1");

  pm2.connect.mockImplementation((callback) => callback());

  pm2.list.mockImplementation((callback) => callback(undefined, inventory()));

  pm2.restart.mockImplementation((_id, callback) => callback());
});

async function fixture(run: (url: string) => Promise<void>, mode = "normal") {
  const app = express();
  const completed: Promise<void>[] = [];
  let finishSeen = false;

  app.post("/", (req, res) => {
    bindRespond(req, res, { defaultLimit: 20, maxLimit: 100 });

    res.once("finish", () => {
      finishSeen = true;
    });

    if (mode === "cancel") {
      // Simulate a peer disconnect before the acknowledgment can finish.
      res.respond = () => {
        res.destroy();

        return res;
      };
    }

    if (mode === "changed") {
      res.once("finish", () => {
        pm2.list.mockImplementation((callback) =>
          callback(undefined, [{ ...inventory()[0], pid: 9999 }]),
        );
      });
    }

    const pending = restartAfterResponse(
      res,
      req.query.invalid ? ["foreign"] : ["api"],
    ).catch((error) => {
      errorHandler("test")(error, req, res, () => {});
    });

    completed.push(pending);
  });

  const server = app.listen(0, "127.0.0.1");

  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();

  if (!address || typeof address === "string") throw new Error("No listener");

  pm2.restart.mockImplementation((_id, callback) => {
    expect(finishSeen).toBe(true);

    callback(
      mode === "failed" ? new Error("private daemon canary") : undefined,
    );
  });

  try {
    await run("http://127.0.0.1:" + address.port + "/");

    await Promise.all(completed);
  } finally {
    server.closeAllConnections();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("the complete 202 acknowledgment precedes every restart command", async () => {
  await fixture(async (url) => {
    const response = await fetch(url, { method: "POST" });

    expect(response.status).toBe(202);

    expect(await response.json()).toMatchObject({
      success: true,
      data: { accepted: true, supervised: true, scheduled: ["api"] },
    });
  });

  expect(pm2.restart).toHaveBeenCalledOnce();
  expect(pm2.disconnect).toHaveBeenCalledOnce();
});

test("invalid targets fail before acceptance or restart", async () => {
  await fixture(async (url) => {
    const response = await fetch(url + "?invalid=1", { method: "POST" });

    expect(response.status).toBe(400);

    expect(await response.json()).toMatchObject({
      errors: [{ code: "INVALID_RESTART_TARGETS" }],
    });
  });

  expect(pm2.restart).not.toHaveBeenCalled();
});

test("a connection lost before response finish cancels the prepared restart", async () => {
  await fixture(async (url) => {
    await expect(fetch(url, { method: "POST" })).rejects.toThrow();
  }, "cancel");

  expect(pm2.restart).not.toHaveBeenCalled();
  expect(pm2.disconnect).toHaveBeenCalledOnce();
});

test("a replaced process after acceptance is not restarted or exposed as an HTTP error", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    await fixture(async (url) => {
      const response = await fetch(url, { method: "POST" });

      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ data: { accepted: true } });
    }, "changed");

    expect(pm2.restart).not.toHaveBeenCalled();

    expect(log).toHaveBeenCalledWith(
      "[settings] accepted restart did not complete",
      {
        code: "RESTART_FAILED",
      },
    );
  } finally {
    log.mockRestore();
  }
});

test("overlapping requests cannot share or disconnect the active PM2 client", async () => {
  let release!: () => void;

  pm2.connect.mockImplementation((callback) => {
    release = () => callback();
  });

  await fixture(async (url) => {
    const pending = fetch(url, { method: "POST" });

    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    const overlapping = await fetch(url, { method: "POST" });

    expect(overlapping.status).toBe(409);
    expect(pm2.disconnect).not.toHaveBeenCalled();

    release();

    expect((await pending).status).toBe(202);
  });

  expect(pm2.disconnect).toHaveBeenCalledOnce();
});

test("a post-acceptance driver failure is reported without rewriting the HTTP response", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    await fixture(async (url) => {
      const response = await fetch(url, { method: "POST" });

      expect(response.status).toBe(202);

      expect((await response.text()).includes("private daemon canary")).toBe(
        false,
      );
    }, "failed");

    expect(log).toHaveBeenCalledWith(
      "[settings] accepted restart did not complete",
      {
        code: "RESTART_FAILED",
      },
    );

    expect(pm2.disconnect).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});

test("an unresponsive PM2 connection produces a bounded sanitized 503", async () => {
  pm2.connect.mockImplementation(() => {});

  await fixture(async (url) => {
    const response = await fetch(url, { method: "POST" });

    expect(response.status).toBe(503);

    expect(await response.json()).toMatchObject({
      errors: [{ code: "RESTART_UNAVAILABLE" }],
    });
  });

  expect(pm2.restart).not.toHaveBeenCalled();
  expect(pm2.disconnect).toHaveBeenCalledOnce();
});
