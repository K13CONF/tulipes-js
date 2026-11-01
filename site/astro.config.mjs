import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { createStarlightTypeDocPlugin } from "starlight-typedoc";
import { fileURLToPath } from "node:url";
import { apiPackages } from "./api-packages.mjs";

// The only two lines to change for a custom domain (plus a public/CNAME file).
const site = "https://k13conf.github.io";
const base = "/tulipes-js";

const apiDocs = apiPackages.map(({ dir, name, tsconfig, entryPoints }) => {
  const [plugin, sidebar] = createStarlightTypeDocPlugin();
  return {
    sidebar,
    plugin: plugin({
      entryPoints,
      tsconfig,
      output: `reference/api/${dir.replace(".", "-")}`, // a dot in a folder breaks Starlight slugs
      sidebar: { label: name, collapsed: true },
      typeDoc: {
        name,
        plugin: [fileURLToPath(new URL("./typedoc-seo.mjs", import.meta.url))],
        excludeExternals: true,
        // "index" keeps each module's overview page: starlight-typedoc deletes nested README.md pages.
        entryFileName: "index",
        gitRemote: "origin",
      },
    }),
  };
});
process.env.TULIPES_IMPORT_PATHS = JSON.stringify(Object.assign({}, ...apiPackages.map(p => p.importPaths))); // read by typedoc-seo.mjs

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Tulipes",
      description:
        "Tulipes is a TypeScript framework for Express 5 that checks everything at boot: modules, roles, environment, models, queues and sockets.",
      logo: {
        light: "../packages/core/assets/brand/lockup-horizontal.svg",
        dark: "../packages/core/assets/brand/lockup-horizontal-dark.svg",
        alt: "Tulipes",
        replacesTitle: true,
      },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/K13CONF/tulipes-js" }],
      editLink: { baseUrl: "https://github.com/K13CONF/tulipes-js/edit/master/site/" },
      lastUpdated: true,
      expressiveCode: { themes: ["github-dark-default", "github-light-default"], styleOverrides: { borderRadius: "0.75rem" } },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      plugins: apiDocs.map(doc => doc.plugin),
      customCss: ["./src/styles/theme.css"],
      // The learning path, in reading order. Pages order themselves with `sidebar.order`.
      sidebar: [
        { label: "Start here", items: [{ autogenerate: { directory: "start" } }] },
        { label: "Tutorial: a bookstore API", items: [{ autogenerate: { directory: "tutorial" } }] },
        { label: "How Tulipes works", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        { label: "Packages", items: [{ autogenerate: { directory: "packages" } }] },
        { label: "Production", items: [{ autogenerate: { directory: "production" } }] },
        {
          label: "Reference",
          items: [
            { autogenerate: { directory: "reference/topics" } },
            { label: "CLI commands", collapsed: true, items: [{ autogenerate: { directory: "reference/cli" } }] },
            { label: "TypeScript API (generated)", collapsed: true, items: apiDocs.map(doc => doc.sidebar) },
          ],
        },
      ],
      head: [
        // robots.txt at a github.io subpath is never read, so the sitemap is advertised here.
        { tag: "link", attrs: { rel: "sitemap", href: `${base}/sitemap-index.xml` } },
        { tag: "meta", attrs: { property: "og:image", content: `${site}${base}/social-card.png` } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1280" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "640" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${site}${base}/social-card.png` } },
      ],
    }),
  ],
});
