import type { ReactElement } from "react"
import type { TFunction } from "i18next"
import { WelcomeEmail, type WelcomeProps } from "./templates/welcome.js"
import { ResetPasswordEmail, type ResetPasswordProps } from "./templates/reset-password.js"

/** A renderable email: a component receiving its data plus the bound `t`. */
type TemplateComponent<P> = (props: P & { t: TFunction }) => ReactElement

interface TemplateDefinition<P> {
    component: TemplateComponent<P>
    /** i18n key (in the `emails` namespace) used for the subject line. */
    subjectKey: string
}

/**
 * Email registry — the single source of truth. Map a key to its component and
 * subject key here; the key and its required data type then flow automatically
 * through `renderEmail` / `sendTemplatedMail` (see `EmailTemplateKey`/`EmailData`).
 */
export const emailTemplates = {
    welcome: {
        component: WelcomeEmail,
        subjectKey: "welcome.subject",
    } satisfies TemplateDefinition<WelcomeProps>,
    "reset-password": {
        component: ResetPasswordEmail,
        subjectKey: "resetPassword.subject",
    } satisfies TemplateDefinition<ResetPasswordProps>,
}

/** Valid template keys (`"welcome" | "reset-password" | …`). */
export type EmailTemplateKey = keyof typeof emailTemplates

/** Extracts a template's own data type (its props minus the injected `t`). */
type DataOf<C> = C extends (props: infer A) => unknown ? Omit<A, "t"> : never

/** Maps each template key to the data its caller must provide. */
export type EmailData = {
    [K in EmailTemplateKey]: DataOf<(typeof emailTemplates)[K]["component"]>
}
