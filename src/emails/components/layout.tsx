import {
    Body,
    Container,
    Head,
    Hr,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Text,
} from "@react-email/components"
import type { CSSProperties, ReactNode } from "react"
import { theme } from "../theme.js"

interface EmailLayoutProps {
    /** Inbox preview snippet (rendered hidden, shown by clients next to the subject). */
    preview: string
    children: ReactNode
}

/**
 * Shared shell for every email: document head, themed background, a centered
 * card with the brand header, and a footer. Templates supply only their inner
 * content — branding and theme live here so they're defined once.
 */
export function EmailLayout({ preview, children }: EmailLayoutProps) {
    return (
        <Html>
            <Head />
            <Preview>{preview}</Preview>
            <Body style={body}>
                <Container style={container}>
                    <Section style={header}>
                        <Img
                            src={theme.brand.logoUrl}
                            alt={theme.brand.name}
                            height={40}
                            style={logo}
                        />
                    </Section>

                    <Section style={card}>{children}</Section>

                    <Hr style={hr} />

                    <Section style={footer}>
                        <Text style={footerText}>
                            © {new Date().getFullYear()} {theme.brand.name}. All rights reserved.
                        </Text>
                        <Link href={theme.brand.url} style={footerLink}>
                            {theme.brand.url}
                        </Link>
                    </Section>
                </Container>
            </Body>
        </Html>
    )
}

const body: CSSProperties = {
    backgroundColor: theme.color.background,
    fontFamily: theme.font.family,
    margin: 0,
    padding: `${theme.spacing.gutter} 0`,
}

const container: CSSProperties = {
    maxWidth: theme.spacing.container,
    margin: "0 auto",
    padding: `0 ${theme.spacing.gutter}`,
}

const header: CSSProperties = {
    padding: `${theme.spacing.gutter} 0`,
    textAlign: "center",
}

const logo: CSSProperties = {
    margin: "0 auto",
}

const card: CSSProperties = {
    backgroundColor: theme.color.surface,
    border: `1px solid ${theme.color.border}`,
    borderRadius: theme.radius,
    padding: theme.spacing.gutter,
}

const hr: CSSProperties = {
    borderColor: theme.color.border,
    margin: `${theme.spacing.gutter} 0`,
}

const footer: CSSProperties = {
    textAlign: "center",
}

const footerText: CSSProperties = {
    color: theme.color.muted,
    fontSize: theme.font.size.small,
    margin: "0 0 4px",
}

const footerLink: CSSProperties = {
    color: theme.color.muted,
    fontSize: theme.font.size.small,
}
