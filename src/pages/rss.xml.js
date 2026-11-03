import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { byNewest, postPath, withBase } from '../lib/posts';

export async function GET(context) {
  const posts = (await getCollection('posts', ({ data }) => data.status === 'public')).sort(byNewest);
  return rss({
    title: '도토리 창고',
    description: '코드와 사유 사이의 기록',
    site: new URL(import.meta.env.BASE_URL, context.site),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      pubDate: post.data.date,
      link: withBase(postPath(post)),
      categories: post.data.tags,
    })),
    customData: '<language>ko-KR</language>',
  });
}
