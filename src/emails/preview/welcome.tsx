import type { TFunction } from "i18next"
import { WelcomeEmail } from "../templates/welcome.js"
import { previewT } from "./preview-t.js"

/** Preview entry for the react-email dev app (default export = rendered email). */
export default function WelcomePreview() {
    return (
        <WelcomeEmail
            name="Jane Doe"
            verifyUrl="https://app.example.com/verify?token=preview"
            t={previewT as unknown as TFunction}
        />
    )
}
