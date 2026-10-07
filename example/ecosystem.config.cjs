// PM2 definitions for both Tulipes processes in all three modes.
//
//   pnpm pm2:start              development
//   pnpm pm2:start:staging      staging
//   pnpm pm2:start:production   production
//   pnpm pm2:stop | pm2:restart | pm2:delete | pm2:logs | pm2:status
//
// CommonJS on purpose: this app is an ESM package, and PM2 reads its
// config with require().

/**
 * Each block repeats both variables rather than relying on PM2 merging
 * env_<name> over env: a half-applied environment (right APP_ENV, wrong
 * PROCESS_MODE) would start the wrong process against the wrong config,
 * and the repetition is cheap insurance against that.
 */
const modes = (processMode) => ({
  env: { APP_ENV: "development", PROCESS_MODE: processMode },
  env_staging: { APP_ENV: "staging", PROCESS_MODE: processMode },
  env_production: { APP_ENV: "production", PROCESS_MODE: processMode },
});

/** Shared by both apps. */
const common = {
  cwd: __dirname,
  // Node 24 strips types natively, so PM2 runs the TypeScript entrypoints
  // with node itself: no loader, no build step, nothing to point elsewhere.
  interpreter: "node",
  // Fork, not cluster: Socket.IO needs sticky sessions or the Redis
  // adapter before a second instance is safe, and bootstrap tasks would
  // run once per instance. Scale out only after wiring the adapter.
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  max_memory_restart: "512M",
  // Graceful shutdown drains queues and closes mongo and redis. PM2's
  // default 1.6s SIGKILL would cut that short and lose in-flight jobs.
  kill_timeout: 10000,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "tulipes-example",
      script: "app.ts",
      error_file: "logs/backend-error.log",
      out_file: "logs/backend-out.log",
      ...modes("backend"),
    },
    {
      ...common,
      name: "tulipes-example-worker",
      script: "worker.ts",
      error_file: "logs/worker-error.log",
      out_file: "logs/worker-out.log",
      ...modes("worker"),
    },
  ],
};
