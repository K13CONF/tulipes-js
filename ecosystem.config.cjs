/**
 * PM2 process definitions.
 *
 * Clustering is owned by PM2 — the app no longer forks via node:cluster. The web
 * app runs in cluster mode (one instance per core, port load-balanced); the
 * worker runs in fork mode (no port; scale with `instances`).
 *
 * Build first (`yarn build`), then start with an environment:
 *   pm2 start ecosystem.config.cjs --env development
 *   pm2 start ecosystem.config.cjs --env staging
 *   pm2 start ecosystem.config.cjs --env production
 *
 * `--env <name>` overlays the matching `env_<name>` block. Vars set here override
 * the `.envs/.env.<NODE_ENV>` file (process.env wins over dotenv), so PM2 forces
 * `LOG_TO_FILE=false` (PM2 captures stdout) and `WORKER_INLINE=false` (the
 * dedicated worker process consumes jobs — even in dev under PM2).
 */
const web = {
    name: "bp-web",
    script: "build/Application.js",
    exec_mode: "cluster",
    instances: "1", // one per CPU core; PM2 load-balances the port
    kill_timeout: 10000, // match the app's graceful-shutdown window
    // Capture stdout/stderr into ./logs (next to where pino would write) instead
    // of ~/.pm2/logs. Lines stay pure JSON (no PM2 timestamp prefix) so
    // `yarn pm2:logs` can pipe them through pino-pretty. `merge_logs` folds all
    // cluster instances into one file. Rotate these with `pm2 install pm2-logrotate`.
    out_file: "./logs/bp-web.out.log",
    error_file: "./logs/bp-web.error.log",
    merge_logs: true,
    env: {
        NODE_ENV: "development",
        LOG_TO_FILE: "false",
        WORKER_INLINE: "false",
    },
    env_staging: {
        NODE_ENV: "staging",
        LOG_TO_FILE: "false",
        WORKER_INLINE: "false",
    },
    env_production: {
        NODE_ENV: "production",
        LOG_TO_FILE: "false",
        WORKER_INLINE: "false",
    },
}

const worker = {
    name: "bp-worker",
    script: "build/worker.js",
    exec_mode: "cluster", // no port to share; scale with `instances`
    instances: 1,
    kill_timeout: 30000, // give in-flight jobs time to finish before SIGKILL
    out_file: "./logs/bp-worker.out.log",
    error_file: "./logs/bp-worker.error.log",
    merge_logs: true,
    env: {
        NODE_ENV: "development",
        LOG_TO_FILE: "false",
    },
    env_staging: {
        NODE_ENV: "staging",
        LOG_TO_FILE: "false",
    },
    env_production: {
        NODE_ENV: "production",
        LOG_TO_FILE: "false",
    },
}

module.exports = { apps: [web, worker] }
