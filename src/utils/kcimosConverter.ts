/**
 * kcimos 爬蟲資料 → SupplierProduct 轉換器
 */
import { SupplierProduct } from './supplierProductSchema';

export interface ScrapedProduct {
  category: string;
  name: string;
  retail_price: string;
  cost: string;
  vendor_product_id: string;
}

export interface ScrapeConfig {
  excluded_patterns: string[];
  auto_exclude_rules: {
    max_cost: number;
    max_retail_price: number;
    min_cost: number;
  };
}

export function shouldExclude(product: ScrapedProduct, config: ScrapeConfig): { excluded: boolean; reason: string } {
  const cost = parseFloat(product.cost);
  const price = parseFloat(product.retail_price);

  if (isNaN(cost) || isNaN(price)) return { excluded: true, reason: '價格解析失敗' };
  if (cost >= (config.auto_exclude_rules?.max_cost || 9999)) return { excluded: true, reason: `成本 >= ${config.auto_exclude_rules.max_cost} (佔位符)` };
  if (price >= (config.auto_exclude_rules?.max_retail_price || 9999)) return { excluded: true, reason: `售價 >= ${config.auto_exclude_rules.max_retail_price} (佔位符)` };
  if (cost < (config.auto_exclude_rules?.min_cost || 1)) return { excluded: true, reason: `成本 < ${config.auto_exclude_rules.min_cost} (零成本)` };
  if (!product.name || product.name.trim() === '') return { excluded: true, reason: '名稱為空' };

  for (const pattern of config.excluded_patterns || []) {
    try {
      if (new RegExp(pattern).test(product.name)) {
        return { excluded: true, reason: `匹配排除模式: ${pattern}` };
      }
    } catch (e) { /* ignore invalid regex */ }
  }

  return { excluded: false, reason: '' };
}

export function convertKcimosToSupplierProducts(
  scrapedProducts: ScrapedProduct[],
  config: ScrapeConfig,
  excludedVendorIds: Set<string> = new Set()
): { included: SupplierProduct[]; excluded: { product: ScrapedProduct; reason: string }[] } {
  const included: SupplierProduct[] = [];
  const excluded: { product: ScrapedProduct; reason: string }[] = [];

  for (const p of scrapedProducts) {
    if (excludedVendorIds.has(p.vendor_product_id)) {
      excluded.push({ product: p, reason: '人工排除' });
      continue;
    }

    const { excluded: isExcluded, reason } = shouldExclude(p, config);
    if (isExcluded) {
      excluded.push({ product: p, reason });
      continue;
    }

    included.push({
      supplier_sku: p.vendor_product_id,
      name: p.name,
      category: p.category,
      wholesale_price: parseFloat(p.cost) || undefined,
      retail_price: parseFloat(p.retail_price) || undefined,
      currency: 'TWD',
      source: 'crawler',
      source_platform: 'kcimos',
      fetched_at: new Date().toISOString(),
    });
  }

  return { included, excluded };
}
