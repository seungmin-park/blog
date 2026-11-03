import { defineConfig } from 'astro/config';
import { imageBasePlugin } from './src/lib/markdown-images.mjs';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.SITE_URL || 'https://example.github.io',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap({
    filter: (page) => !page.includes('/admin/'),
  })],
  markdown: {
    processor: unified({ smartypants: false, rehypePlugins: [imageBasePlugin(process.env.BASE_PATH || '/')] }),
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: true,
    },
  },
});
