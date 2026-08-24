import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export const byNewest = (a: Post, b: Post) => b.data.date.valueOf() - a.data.date.valueOf();

export const postPath = (post: Post) => `posts/${post.data.slug}/`;

export const formatDate = (date: Date, short = false) =>
  new Intl.DateTimeFormat('ko-KR', short
    ? { month: '2-digit', day: '2-digit' }
    : { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date)
    .replace(/\.\s?/g, '.');

export const withBase = (path: string) => {
  const base = import.meta.env.BASE_URL;
  return `${base}${path.replace(/^\//, '')}`.replace(/\/+/g, '/');
};
