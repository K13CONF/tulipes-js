import mongoose from "mongoose"
import { logger } from "@config/logger.js"

/** Database connection settings (sourced from `config.app.lib.database`). */
export interface DatabaseConfig {
    protocol: string
    host: string
    port: number
    name: string
    user: string
    password: string
}

/** Builds a MongoDB connection URI from the database config. */
function buildConnectionUri(db: DatabaseConfig): string {
    const credentials = db.user
        ? `${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@`
        : ""
    // `mongodb+srv` URIs must omit the port.
    const host = db.protocol === "mongodb+srv" ? db.host : `${db.host}:${db.port}`
    return `${db.protocol}://${credentials}${host}/${db.name}`
}

/**
 * Connects to MongoDB via Mongoose. Resolves once the initial connection is
 * established; rejects (so startup can fail fast) if it can't connect.
 */
export async function connect(db: DatabaseConfig): Promise<typeof mongoose> {
    mongoose.connection.on("connected", () => logger.info("✅ MongoDB connected"))
    mongoose.connection.on("error", (error) => logger.error({ err: error }, "MongoDB connection error"))
    mongoose.connection.on("disconnected", () => logger.warn("⚠️ MongoDB disconnected"))

    await mongoose.connect(buildConnectionUri(db), {
        serverSelectionTimeoutMS: 10_000,
    })

    return mongoose
}

/** Closes the Mongoose connection (e.g. on graceful shutdown). */
export async function disconnect(): Promise<void> {
    await mongoose.disconnect()
}

/** Whether the Mongoose connection is currently established (readyState 1). */
export function isConnected(): boolean {
    return mongoose.connection.readyState === 1
}
