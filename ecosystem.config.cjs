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
    instances: "max", // one per CPU core; PM2 load-balances the port
    kill_timeout: 10000, // match the app's graceful-shutdown window
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
    exec_mode: "fork", // no port to share; scale with `instances`
    instances: 1,
    kill_timeout: 30000, // give in-flight jobs time to finish before SIGKILL
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
