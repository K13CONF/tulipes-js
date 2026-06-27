import nodemailer, { type Transporter } from "nodemailer"
import type { Job } from "bullmq"
import { getQueue, registerJobHandler } from "./queue.js"
import { logger } from "@config/logger.js"

/** Mailer settings (sourced from `config.app.lib.mailer`). */
export interface MailerConfig {
    from: string
    host: string
    port: number
    secure: boolean
    user: string
    password: string
    /** When true, `sendMail` enqueues a job instead of delivering inline. */
    queueEnabled: boolean
    /** nodemailer transport-level logging. */
    loggingEnabled: boolean
}

/** A single email to send. */
export interface MailPayload {
    to: string | string[]
    subject: string
    text?: string
    html?: string
    /** Overrides the configured default sender. */
    from?: string
}

/** Job name used on the shared queue for queued mail. */
const MAIL_JOB = "send-mail"

let transporter: Transporter | null = null
let config: MailerConfig

/**
 * Builds the SMTP transport and registers the queue handler for mail jobs. Call
 * once during boot, after the queue is set up (so the worker can deliver).
 */
export function initMailer(cfg: MailerConfig): void {
    config = cfg
    transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        ...(cfg.user ? { auth: { user: cfg.user, pass: cfg.password } } : {}),
        logger: cfg.loggingEnabled,
    })
    // The worker delivers queued mail through this same transport.
    registerJobHandler(MAIL_JOB, (job: Job<MailPayload>) => deliver(job.data))
}

/**
 * Sends an email. Enqueued onto the shared queue when `MAILER_QUEUE_ENABLED`
 * (SMTP latency + retries handled by the worker), otherwise delivered inline.
 */
export async function sendMail(payload: MailPayload): Promise<void> {
    if (config.queueEnabled) {
        await getQueue().add(MAIL_JOB, payload)
        return
    }
    await deliver(payload)
}

/** Hands a message to the SMTP transport. */
async function deliver(payload: MailPayload): Promise<void> {
    if (!transporter) throw new Error("Mailer not initialized — call initMailer() during boot first")

    const info = await transporter.sendMail({
        from: payload.from ?? config.from,
        to: payload.to,
        subject: payload.subject,
        ...(payload.text ? { text: payload.text } : {}),
        ...(payload.html ? { html: payload.html } : {}),
    })
    logger.info({ messageId: info.messageId, to: payload.to }, "Email sent")
}

/** Closes the SMTP transport (e.g. on graceful shutdown). */
export function closeMailer(): void {
    transporter?.close()
    transporter = null
}
