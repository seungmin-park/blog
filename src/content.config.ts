import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    status: z.enum(['draft', 'public']),
    aliases: z.array(z.string().regex(/^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/u)).default([]),
    tags: z.array(z.string()).default([]),
    category: z.string(),
    thumbnail: z.string().optional(),
    summary: z.string(),
    lead: z.string().optional(),
    author: z.string().default('박승민'),
    commit: z.string().regex(/^[a-f0-9]{6}$/),
    featured: z.boolean().default(false),
  }),
});

export const collections = { posts };
