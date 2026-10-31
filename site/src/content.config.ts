import { defineCollection, z } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// SEO floor (plan §4): every page states its own title and description, within search-result lengths.
// Titles cap at 50 because Starlight appends " | Tulipes" (10 characters) for a 60-character <title>.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        title: z.string().min(1).max(50),
        description: z.string().min(120).max(160),
      }),
    }),
  }),
};
