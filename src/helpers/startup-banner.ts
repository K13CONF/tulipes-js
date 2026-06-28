import {
    bold,
    cyan,
    cyanBright,
    dim,
    gray,
    green,
    greenBright,
    magenta,
    red,
} from "colorette"
import config from "@config/app.config.js"

/** Everything the startup banner needs to render. */
export interface StartupInfo {
    title: string
    version: string
    description: string
    env: string
    host: string
    port: number
    apiBasePath: string
    database: {
        protocol: string
        host: string
        port: number
        name: string
        connected: boolean
    }
    modules: string[]
    rolesCount: number
    /** Milliseconds the boot sequence took (optional). */
    bootMs?: number
}

/** Picks an accent color for the environment label. */
function envColor(env: string): (text: string) => string {
    if (env === "production") return greenBright
    if (env === "test") return magenta
    return cyanBright
}

/** A colored status dot. */
function dot(ok: boolean): string {
    return ok ? green("●") : red("●")
}

type LIB = typeof config.app.lib;

/** Builds the data shown in the startup banner / structured "server started" log. */
export function buildStartupInfo(bootStartedAt: number, lib: LIB, isConnected: () => boolean): StartupInfo {
    const { server, database } = lib
    return {
        title: config.app.title,
        version: config.app.version,
        description: config.app.description,
        env: config.app.env,
        host: server.host,
        port: server.port,
        apiBasePath: `${config.app.api.prefix}/${config.app.api.version}`,
        database: {
            protocol: database.protocol,
            host: database.host,
            port: database.port,
            name: database.name,
            connected: isConnected(),
        },
        modules: Object.keys(config.app.modules),
        rolesCount: config.app.roles.length,
        bootMs: Date.now() - bootStartedAt,
    }
}

/**
 * Prints a modern, colored startup banner to the console summarizing server,
 * database and application state. Colorette automatically strips ANSI when the
 * output isn't a TTY (piped / production log collectors), so this stays safe to
 * call in every environment.
 */
export function printStartupBanner(info: StartupInfo): void {
    // TLS is terminated upstream (nginx); the app listens over plain HTTP.
    const localUrl = `http://${info.host}:${info.port}`
    const apiUrl = `${localUrl}${info.apiBasePath}`
    const dbUrl = `${info.database.protocol}://${info.database.host}:${info.database.port}/${info.database.name}`
    const ec = envColor(info.env)

    const rows: Array<[string, string]> = [
        ["Environment", ec(bold(info.env))],
        ["Server", `${cyan(localUrl)}  ${dot(true)} ${green("listening")}`],
        ["API base", cyan(apiUrl)],
        [
            "Database",
            `${cyan(dbUrl)}  ${dot(info.database.connected)} ${info.database.connected ? green("connected") : red("disconnected")
            }`,
        ],
        ["Modules", `${bold(String(info.modules.length))} ${gray(`(${info.modules.join(", ") || "none"})`)}`],
        ["Roles", bold(String(info.rolesCount))],
        [
            "Runtime",
            `${gray(`Node ${process.version}`)}  ${dim("·")}  ${gray(`PID ${process.pid}`)}${info.bootMs !== undefined ? `  ${dim("·")}  ${gray(`ready in ${info.bootMs}ms`)}` : ""
            }`,
        ],
    ]

    const labelWidth = Math.max(...rows.map(([label]) => label.length))
    const arrow = green("➜")

    const lines: string[] = [
        "",
        `  ${bold(cyan(`▲ ${info.title}`))} ${dim(`v${info.version}`)}`,
        `  ${dim(info.description)}`,
        "",
    ]
    for (const [label, value] of rows) {
        lines.push(`  ${arrow}  ${bold(label.padEnd(labelWidth))}   ${value}`)
    }
    lines.push("")

    console.log(lines.join("\n"))
}
