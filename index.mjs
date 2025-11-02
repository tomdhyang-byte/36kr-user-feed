import { create } from 'xmlbuilder2';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const USER_ID = process.env.USER_ID || '5081058'; // target user
const BASE = 'https://www.36kr.com';
const OUTPUT_DIR = 'docs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'feed.xml');

// Feed basic info
const FEED_TITLE = '刀客Doc';
const FEED_DESC = `36氪用户 ${USER_ID} 的文章更新`;
const SELF_URL = `https://tomdhyang-byte.github.io/36kr-user-feed/feed.xml`;

// Tunables
const MAX_ITEMS = 40;         // 最多輸出幾篇
const PAGE_SIZE = 20;         // 每次 API 取回數量
const PER_ARTICLE_DELAY = 0;  // 這版直接用 API 產資料，通常不需要 delay

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

/**
 * 直接呼叫 36氪 JSON API 拿用戶文章
 * 端點: https://gateway.36kr.com/api/mis/me/article (POST, application/json)
 * 參數:
 * - userId: 目標用戶
 * - pageEvent: 0=first page, 1=next page
 * - pageCallback: 下一頁用的 token（回應 data.pageCallback）
 * - pageSize, siteId=1, platformId=2, partner_id='web', timestamp=Date.now()
 */
async function fetchArticlesViaAPI(userId, maxItems) {
  const url = 'https://gateway.36kr.com/api/mis/me/article';
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Origin': 'https://36kr.com',
    'Referer': 'https://36kr.com/'
  };

  let pageEvent = 0;        // 第一頁
  let pageCallback = '';    // 由回應提供
  const items = [];

  while (items.length < maxItems) {
    const body = {
      partner_id: 'web',
      timestamp: Date.now(),
      param: {
        userId: String(userId),
        pageEvent,
        pageSize: PAGE_SIZE,
        pageCallback,
        siteId: 1,
        platformId: 2
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      timeout: 25000
    });

    if (!res.ok) {
      throw new Error(`API HTTP ${res.status}`);
    }

    const json = await res.json().catch(() => ({}));
    const data = json?.data || json?.dataList || {};
    const list = data?.itemList || data?.items || data?.list || [];

    // 收集文章
    for (const it of list) {
      // 常見欄位示意：itemId, templateMaterial.widgetTitle, templateMaterial.widgetContent, publishTime(ms)
      const id =
        it?.itemId ??
        it?.id ??
        it?.articleId ??
        it?.templateMaterial?.id;

      if (!id) continue;

      const title =
        it?.templateMaterial?.widgetTitle ??
        it?.title ??
        `文章 ${id}`;

      const description =
        it?.templateMaterial?.widgetContent ??
        it?.summary ??
        '';

      // 發佈時間：常見為毫秒時間戳
      const ts =
        it?.publishTime ??
        it?.templateMaterial?.publishTime ??
        it?.createdTime ??
        null;
      const pubDate = ts ? new Date(Number(ts)).toUTCString() : null;

      items.push({
        title: String(title).trim() || `文章 ${id}`,
        link: `${BASE}/p/${id}`,
        pubDate,
        description: String(description || '').trim()
      });

      if (items.length >= maxItems) break;
    }

    // 準備下一頁
    const nextCallback = data?.pageCallback || data?.nextPageCallback || '';
    if (!nextCallback || list.length === 0) {
      break; // 沒有下一頁了
    }
    pageCallback = nextCallback;
    pageEvent = 1; // 後續頁面使用 1
    if (PER_ARTICLE_DELAY) await sleep(PER_ARTICLE_DELAY);
  }

  return items.slice(0, maxItems);
}

async function main() {
  console.log(`Fetching articles via API for user: ${USER_ID}`);

  const items = await fetchArticlesViaAPI(USER_ID, MAX_ITEMS);

  if (!items.length) {
    throw new Error('API 回傳為空，可能是反爬或該用戶目前沒有可見的文章。稍後再試或於本機確認 API 回應內容。');
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const xml = buildRSS({ items });
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
  console.log(`RSS written: ${OUTPUT_FILE}`);
  console.log(`Subscribe URL: ${SELF_URL}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
