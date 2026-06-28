import { Button, Heading, Text } from "@react-email/components"
import type { CSSProperties, ReactNode } from "react"
import { theme } from "../theme.js"

/** Themed primitives so templates never repeat inline styles. */

export function EmailHeading({ children }: { children: ReactNode }) {
    return <Heading style={headingStyle}>{children}</Heading>
}

export function EmailText({ children }: { children: ReactNode }) {
    return <Text style={textStyle}>{children}</Text>
}

export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
    return (
        <Button href={href} style={buttonStyle}>
            {children}
        </Button>
    )
}

const headingStyle: CSSProperties = {
    color: theme.color.text,
    fontSize: theme.font.size.heading,
    fontWeight: 700,
    margin: `0 0 ${theme.spacing.gutter}`,
}

const textStyle: CSSProperties = {
    color: theme.color.text,
    fontSize: theme.font.size.body,
    lineHeight: theme.font.lineHeight,
    margin: `0 0 ${theme.spacing.gutter}`,
}

const buttonStyle: CSSProperties = {
    backgroundColor: theme.color.primary,
    color: theme.color.primaryText,
    fontSize: theme.font.size.body,
    fontWeight: 600,
    textDecoration: "none",
    padding: "12px 24px",
    borderRadius: theme.radius,
    display: "inline-block",
}
