import { create } from 'xmlbuilder2';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const USER_ID = process.env.USER_ID || '5081058'; // target user
const BASE = 'https://www.36kr.com';
const USER_URL = `${BASE}/user/${USER_ID}`;
const OUTPUT_DIR = 'docs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'feed.xml');

// Feed basic info
const FEED_TITLE = '刀客Doc';
const FEED_DESC = `36氪用户 ${USER_ID} 的文章更新`;
const SELF_URL = `https://tomdhyyang-byte.github.io/36kr-user-feed/feed.xml`;

// Tunables
const MAX_ITEMS = 40;
const PER_ARTICLE_DELAY = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(html) {
  return sanitizeHtml(html, {
    allowedTags: ['p','br','strong','em','b','i','u','blockquote','ul','ol','li','a','code','pre','img'],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt']
    },
    allowedSchemes: ['http','https','data'],
    disallowedTagsMode: 'discard'
  });
}

function extractArticleLinks(html) {
  const text = html.replace(/\s+/g, ' ');
  const ids = new Set();

  // 方式 1：傳統 <a href="/p/1234567890">
  let m1;
  const re1 = /href="\/p\/(\d{5,})"/g;
  while ((m1 = re1.exec(text)) !== null) {
    ids.add(m1[1]);
    if (ids.size >= MAX_ITEMS) break;
  }

  // 方式 2：data-articleid="1234567890"
  if (ids.size < MAX_ITEMS) {
    let m2;
    const re2 = /data-articleid="(\d{5,})"/g;
    while ((m2 = re2.exec(text)) !== null) {
      ids.add(m2[1]);
      if (ids.size >= MAX_ITEMS) break;
    }
  }

  // 方式 3：頁面內嵌 JSON（常見鍵：articleId / itemId / id）
  if (ids.size < MAX_ITEMS) {
    let m3;
    const re3 = /(?:"articleId"|"itemId"|"id")\s*:\s*"?(\d{5,})"?/g;
    while ((m3 = re3.exec(text)) !== null) {
      ids.add(m3[1]);
      if (ids.size >= MAX_ITEMS) break;
    }
  }

  // 組網址、去重
  return Array.from(ids).map(id => `${BASE}/p/${id}`);
}

async function fetchArticleMeta(url) {
  try {
    const res = await fetch(url, {
      headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      },
      timeout: 20000
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const ogTitle = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
    const metaTitle = /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
    const titleTag = /<title>([^<]+)<\/title>/i.exec(html)?.[1];

    const ogDesc = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
    const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];

    const pubTime =
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
      /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ||
      /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1];

    const title = (ogTitle || metaTitle || titleTag || '').trim();
    const description = (ogDesc || metaDesc || '').trim();

    return {
      title: title || url,
      description: description || '',
      pubDate: pubTime ? new Date(pubTime).toUTCString() : null
    };
  } catch (err) {
    return {
      title: url,
      description: '',
      pubDate: null
    };
  }
}

function buildRSS({ items }) {
  const feed = {
    rss: {
      '@version': '2.0',
      channel: {
        title: FEED_TITLE,
        link: SELF_URL,
        description: FEED_DESC,
        lastBuildDate: new Date().toUTCString(),
        item: items.map(it => ({
          title: it.title,
          link: it.link,
          guid: it.link,
          pubDate: it.pubDate || new Date().toUTCString(),
          description: { $: sanitize(it.description || '') }
        }))
      }
    }
  };
  return create(feed).end({ prettyPrint: true });
}

async function main() {
  console.log(`Fetching user page: ${USER_URL}`);
  const res = await fetch(USER_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (RSS Generator; +https://github.com/)',
      'Accept': 'text/html,application/xhtml+xml'
    },
    timeout: 25000
  });
  if (!res.ok) {
    throw new Error(`Fetch user page failed: HTTP ${res.status}`);
  }
  const html = await res.text();

  const links = extractArticleLinks(html);
  if (links.length === 0) {
    throw new Error('No article links found. (36氪页面可能改版，或需要改抓取策略)');
  }
  console.log(`Found ${links.length} article links.`);

  const items = [];
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    console.log(`  [${i + 1}/${links.length}] Fetching: ${link}`);
    const meta = await fetchArticleMeta(link);
    items.push({
      title: meta.title,
      link,
      pubDate: meta.pubDate,
      description: meta.description
    });
    await sleep(PER_ARTICLE_DELAY);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const xml = buildRSS({ items });
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
  console.log(`RSS written: ${OUTPUT_FILE}`);

  console.log('\nNext steps:');
  console.log(`1) 打开 GitHub Pages，指向 /docs 资料夹`);
  console.log(`2) 订阅 URL: ${SELF_URL}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
