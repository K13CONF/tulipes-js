import { render } from "@react-email/render"
import { createElement, type FunctionComponent } from "react"
import { emailTemplates, type EmailData, type EmailTemplateKey } from "@/emails/index.js"
import { i18next } from "./i18n.js"

/** i18next namespace holding all transactional email copy (src/emails/i18n). */
const EMAIL_NS = "emails"

/** Delivery-ready output of a rendered template. */
export interface RenderedEmail {
    subject: string
    html: string
    text: string
}

/**
 * Renders an email template to `{ subject, html, text }`, localized to `locale`.
 *
 * `t` is bound to `locale` and the `emails` namespace and injected into the
 * component, so every template's copy is translated. Rendering happens at the
 * call site (where the request locale is known) — the resulting strings are what
 * get enqueued, so the worker never imports React on the delivery path.
 */
export async function renderEmail<K extends EmailTemplateKey>(
    template: K,
    data: EmailData[K],
    locale: string,
): Promise<RenderedEmail> {
    const definition = emailTemplates[template]
    const t = i18next.getFixedT(locale, EMAIL_NS)

    // The registry guarantees `data` matches `component`; the cast just relaxes
    // the per-key correlation that TS can't follow through the generic index.
    const Component = definition.component as unknown as FunctionComponent<Record<string, unknown>>
    const element = createElement(Component, { ...data, t })

    const [html, text] = await Promise.all([render(element), render(element, { plainText: true })])

    return {
        subject: t(definition.subjectKey, data as Record<string, unknown>),
        html,
        text,
    }
}
