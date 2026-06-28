/**
 * Email design tokens — the single source of truth for branding across every
 * template.
 *
 * Email clients (Outlook above all) don't reliably support external CSS,
 * <style> blocks, or class-based targeting, so these tokens are applied as
 * inline styles through the shared <EmailLayout> and the themed primitives in
 * `./components/ui`. Change branding here once and every email follows.
 */
export const theme = {
    brand: {
        name: "Express Boilerplate",
        // Public, absolute URL to a raster logo (PNG/JPG — most clients drop SVG).
        logoUrl: "https://placehold.co/160x40/2563eb/ffffff/png?text=Logo",
        url: "https://example.com",
    },
    color: {
        background: "#f4f4f7",
        surface: "#ffffff",
        text: "#1f2933",
        muted: "#6b7280",
        primary: "#2563eb",
        primaryText: "#ffffff",
        border: "#e5e7eb",
    },
    font: {
        family:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        size: {
            body: "16px",
            small: "14px",
            heading: "24px",
        },
        lineHeight: "1.5",
    },
    spacing: {
        // Max content width — the classic email-safe container width.
        container: "600px",
        gutter: "24px",
    },
    radius: "8px",
} as const

export type Theme = typeof theme
