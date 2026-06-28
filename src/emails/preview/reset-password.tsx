import type { TFunction } from "i18next"
import { ResetPasswordEmail } from "../templates/reset-password.js"
import { previewT } from "./preview-t.js"

/** Preview entry for the react-email dev app (default export = rendered email). */
export default function ResetPasswordPreview() {
    return (
        <ResetPasswordEmail
            name="Jane Doe"
            resetUrl="https://app.example.com/reset?token=preview"
            expiresInMinutes={30}
            t={previewT as unknown as TFunction}
        />
    )
}
