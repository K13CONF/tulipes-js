import type { TFunction } from "i18next"
import { EmailLayout } from "../components/layout.js"
import { EmailButton, EmailHeading, EmailText } from "../components/ui.js"

/** Data this template needs (everything except the injected `t`). */
export interface WelcomeProps {
    name: string
    verifyUrl: string
}

export function WelcomeEmail({ name, verifyUrl, t }: WelcomeProps & { t: TFunction }) {
    return (
        <EmailLayout preview={t("welcome.preview")}>
            <EmailHeading>{t("welcome.heading", { name })}</EmailHeading>
            <EmailText>{t("welcome.body")}</EmailText>
            <EmailButton href={verifyUrl}>{t("welcome.cta")}</EmailButton>
        </EmailLayout>
    )
}
