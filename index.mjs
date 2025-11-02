// index.mjs
import { create } from 'xmlbuilder2';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// === 你原本就有的常數 ===
const OUTPUT_DIR = 'docs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'feed.xml');

// Feed 自己的網址 & 首頁（給 atom:link 與 channel.link）
const FEED_URL = 'https://tomdhyang-byte.github.io/36kr-user-feed/feed.xml';
const SITE_URL = 'https://tomdhyang-byte.github.io/36kr-user-feed/';

// TODO: 這裡替換成你原本產出 items 的函式，回傳陣列：
// [{ title, link, guid?, pubDate, description? }, ...]
async function buildItemsSomehow() {
  // 這是占位：請串接你原有的爬蟲/清單邏輯
  // 我先放兩筆示意，確保結構正確
  return [
    {
      title: '亚马逊和谷歌的广告战争，开始打到云上了',
      link: 'https://www.36kr.com/p/3532943217940873',
      guid: 'https://www.36kr.com/p/3532943217940873',
      pubDate: 'Fri, 31 Oct 2025 12:28:28 GMT',
      description: '亚马逊和谷歌的广告战争升级'
    },
    {
      title: '谷歌终止隐私沙盒计划，也关闭了开放互联网的共识大门？',
      link: 'https://www.36kr.com/p/3517118304246152',
      guid: 'https://www.36kr.com/p/3517118304246152',
      pubDate: 'Mon, 20 Oct 2025 08:19:29 GMT',
      description: '隐私沙盒终止，是互联网广告隐私改革的一个时代句点。'
    }
  ];
}

// 抽取文章全文（桌面版抓不到時自動嘗試行動版）
async function extractArticleHTML(url) {
  const candidates = [
    url,
    url.replace('www.36kr.com', 'm.36kr.com')
  ];
  for (const u of candidates) {
    try {
      const res = await fetch(u, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        },
        timeout: 20000
      });
      if (!res.ok) continue;
      const html = await res.text();

      // 用 Readability 萃取主文
      const dom = new JSDOM(html, { url: u });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (article?.content) {
        // 把連結與圖片轉為絕對 URL，並白名單清洗
        const cleaned = sanitizeHtml(article.content, {
          allowedTags: [
            'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'blockquote',
            'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'pre', 'code', 'img', 'a', 'hr'
          ],
          allowedAttributes: {
            a: ['href', 'title'],
            img: ['src', 'alt', 'title', 'width', 'height', 'loading']
          },
          transformTags: {
            a: (tag, attribs) => {
              try { if (attribs.href) attribs.href = new URL(attribs.href, u).toString(); } catch {}
              return { tagName: tag, attribs };
            },
            img: (tag, attribs) => {
              try { if (attribs.src) attribs.src = new URL(attribs.src, u).toString(); } catch {}
              return { tagName: tag, attribs };
            }
          }
        });
        return cleaned;
      }
    } catch (e) {
      // 繼續下一個候選 URL
    }
  }
  return null;
}

async function main() {
  const items = await buildItemsSomehow();

  // 逐一 enrich：抽全文，抽不到就回退到 description
  const enriched = [];
  for (const it of items) {
    const html = await extractArticleHTML(it.link);
    enriched.push({
      ...it,
      _contentHTML: html // 可能是 null
    });
    // 節流避免被風控：≥ 1 秒
    await new Promise(r => setTimeout(r, 1200));
  }

  // 建 RSS（加上 xmlns:content 與 atom:link）
  const feed = {
    rss: {
      '@version': '2.0',
      '@xmlns:content': 'http://purl.org/rss/1.0/modules/content/',
      '@xmlns:atom': 'http://www.w3.org/2005/Atom',
      channel: {
        title: '刀客Doc',
        link: SITE_URL,
        description: '36氪用户 5081058 的文章更新',
        language: 'zh-CN',
        ttl: 30,
        lastBuildDate: new Date().toUTCString(),
        'atom:link': {
          '@href': FEED_URL,
          '@rel': 'self',
          '@type': 'application/rss+xml'
        },
        item: enriched.map(it => ({
          title: it.title,
          link: it.link,
          guid: { '@isPermaLink': 'true', '#': it.guid || it.link },
          pubDate: it.pubDate,
          description: { '#': `<![CDATA[ ${it.description || ''} ]]>` },
          // 關鍵：把全文寫進 content:encoded，抽不到用摘要兜底
          'content:encoded': {
            '#': `<![CDATA[ ${it._contentHTML || `<p>${it.description || ''}</p>`} ]]>`
          }
        }))
      }
    }
  };

  const xml = create(feed).end({ prettyPrint: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
  console.log('Wrote:', OUTPUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
