import type { TFunction } from "i18next"
import { EmailLayout } from "../components/layout.js"
import { EmailButton, EmailHeading, EmailText } from "../components/ui.js"

/** Data this template needs (everything except the injected `t`). */
export interface ResetPasswordProps {
    name: string
    resetUrl: string
    expiresInMinutes: number
}

export function ResetPasswordEmail({
    name,
    resetUrl,
    expiresInMinutes,
    t,
}: ResetPasswordProps & { t: TFunction }) {
    return (
        <EmailLayout preview={t("resetPassword.preview")}>
            <EmailHeading>{t("resetPassword.heading")}</EmailHeading>
            <EmailText>{t("resetPassword.body", { name, minutes: expiresInMinutes })}</EmailText>
            <EmailButton href={resetUrl}>{t("resetPassword.cta")}</EmailButton>
        </EmailLayout>
    )
}
