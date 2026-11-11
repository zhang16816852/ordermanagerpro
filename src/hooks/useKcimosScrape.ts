import { useState, useCallback } from 'react';
import { SupplierProduct } from '@/utils/supplierProductSchema';

const BASE_URL = '/kcimos';
const LOGIN_ACCOUNT = 'qaz200581';
const LOGIN_PASSWORD = '000000';
const CAPTCHA_CHECK = 'd69768b3da745b77e82cdbddcc8bac98';
const CAPTCHA_VALUE = '8496';
const DELAY_MS = 300;

const EXCLUDED_PATTERNS = ['OEM', '預購中', '售完為止', '已停產', '請至.*專區下單', '保卡'];
const MAX_COST = 9999;
const MAX_PRICE = 9999;
const MIN_COST = 1;

const cookies: Record<string, string> = {};

function setCookiesFromResponse(res: Response) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/^([^=]+)="([^"]*)"/);
    if (match) cookies[match[1]] = '"' + match[2] + '"';
    else {
      const [nameValue] = setCookie.split(';');
      const eqIdx = nameValue.indexOf('=');
      if (eqIdx > 0) cookies[nameValue.substring(0, eqIdx).trim()] = nameValue.substring(eqIdx + 1).trim();
    }
  }
}

function getCookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function parseProductTable(html: string) {
  const products: any[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  let rowIndex = 0;
  while ((trMatch = trRegex.exec(html)) !== null) {
    rowIndex++;
    if (rowIndex === 1) continue;
    const rowHtml = trMatch[1];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) cells.push(tdMatch[1]);
    if (cells.length < 6) continue;
    const category = stripTags(cells[0]);
    const name = stripTags(cells[2]);
    const price = stripTags(cells[3]);
    const cost = stripTags(cells[4]);
    const inputMatch = cells[5].match(/id="([^"]*)"/);
    const btnId = inputMatch ? inputMatch[1] : null;
    if (name) products.push({ category, name, retail_price: price, cost, vendor_product_id: btnId });
  }
  return products;
}

function parseCategoryList(html: string) {
  const categories: { id: string; name: string }[] = [];
  const linkRegex = /<a[^>]*productcatpk="(\d+)"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    categories.push({ id: match[1], name: match[2].trim() });
  }
  return categories;
}

function shouldExclude(product: { name: string; cost: string; retail_price: string }): boolean {
  const cost = parseFloat(product.cost);
  const price = parseFloat(product.retail_price);
  if (isNaN(cost) || isNaN(price)) return true;
  if (cost >= 9999) return true;
  if (price >= 9999) return true;
  if (cost < 1) return true;
  if (!product.name || product.name.trim() === '') return true;
  for (const pattern of ['OEM', '預購中', '售完為止', '已停產', '請至.*專區下單', '保卡']) {
    try {
      if (new RegExp(pattern).test(product.name)) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}

export interface ScrapeResult {
  success: boolean;
  total_scraped: number;
  excluded_count: number;
  included_count: number;
  products: SupplierProduct[];
  error?: string;
}

export function useKcimosScrape() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResult | null>(null);

  const scrape = useCallback(async (): Promise<ScrapeResult | null> => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const workerUrl = import.meta.env.VITE_KCIMOS_WORKER_URL;
      if (workerUrl) {
        const res = await fetch(`${workerUrl}/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '抓取失敗');
        const scrapeResult: ScrapeResult = {
          success: true,
          total_scraped: data.total_scraped,
          excluded_count: data.excluded_auto + data.excluded_pattern,
          included_count: data.included_count,
          products: data.products,
        };
        setResult(scrapeResult);
        return scrapeResult;
      }

      const loginRes = await fetch('/kcimos/login.shtml', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'http://kcimos.kv.idv.tw/frontend/login.html',
        },
        credentials: 'include',
        body: `login.type=1&login.captchaCheck=${CAPTCHA_CHECK}&login.account=${LOGIN_ACCOUNT}&login.password=${LOGIN_PASSWORD}&login.captcha=${CAPTCHA_VALUE}`,
      });
      setCookiesFromResponse(loginRes);
      const loginResult = await loginRes.json();
      if (!loginResult.status) throw new Error(`登入失敗: ${loginResult.msg}`);

      const fastOrderRes = await fetch('/kcimos/frontend/initFastOrder.shtml', {
        headers: { Cookie: getCookieHeader(), 'Referer': 'http://kcimos.kv.idv.tw/frontend/initFastOrder.shtml' },
        credentials: 'include',
      });
      const categories = parseCategoryList(await fastOrderRes.text());

      const allProducts: any[] = [];
      for (const cat of categories) {
        const res = await fetch('/kcimos/frontend/product/listProduct.shtml', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: getCookieHeader(),
            'Referer': 'http://kcimos.kv.idv.tw/frontend/initFastOrder.shtml',
          },
          credentials: 'include',
          body: `productCatPk=${cat.id}`,
        });
        const products = parseProductTable(await res.text());
        allProducts.push(...products);
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }

      const included: any[] = [];
      let excludedCount = 0;
      for (const p of allProducts) {
        if (shouldExclude(p)) { excludedCount++; continue; }
        included.push(p);
      }

      const supplierProducts: SupplierProduct[] = included.map((p) => ({
        supplier_sku: p.vendor_product_id,
        name: p.name,
        category: p.category,
        wholesale_price: parseFloat(p.cost) || undefined,
        retail_price: parseFloat(p.retail_price) || undefined,
        currency: 'TWD',
        source: 'crawler',
        source_platform: 'kcimos',
        fetched_at: new Date().toISOString(),
      }));

      const scrapeResult: ScrapeResult = {
        success: true,
        total_scraped: allProducts.length,
        excluded_count: excludedCount,
        included_count: included.length,
        products: supplierProducts,
      };

      setResult(scrapeResult);
      return scrapeResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, result, scrape };
}
