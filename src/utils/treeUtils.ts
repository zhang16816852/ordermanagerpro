import { deserializeSpecs, formatSpecValue } from '@/utils/specLogic';

/**
 * BFS 遍歷類別層級，取得所有子類別 ID（含自身）
 */
export function getSubCategoryIds(
  selectedCategoryId: string | null,
  categoryHierarchy: { parent_id: string; child_id: string }[]
): Set<string> {
  if (!selectedCategoryId) return new Set<string>();
  const ids = new Set<string>([selectedCategoryId]);
  const queue = [selectedCategoryId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const h of categoryHierarchy) {
      if (h.parent_id === parentId && !ids.has(h.child_id)) {
        ids.add(h.child_id);
        queue.push(h.child_id);
      }
    }
  }
  return ids;
}

/**
 * 檢查指定 spec 值是否匹配已選的規格篩選條件
 */
export function matchesSpecFilters(
  target: any,
  selectedSpecs: Record<string, string[]>
): boolean {
  const specKeys = Object.keys(selectedSpecs);
  if (specKeys.length === 0) return true;
  if (!target) return false;

  const isVariant = 'product_id' in target;
  const flatSettings = deserializeSpecs(target.spec_values);

  return specKeys.every((key) => {
    const allowedValues = selectedSpecs[key];
    if (!allowedValues || allowedValues.length === 0) return true;

    let actualValue = "";

    if (key.startsWith('core:')) {
      if (!isVariant) return false;
      const optionKey = key.replace('core:', '');
      actualValue = target[optionKey] || "";
    } else {
      const val = flatSettings[key];
      actualValue = formatSpecValue(val);
    }

    if (!actualValue) return false;

    const isRangeFilter = allowedValues.length === 1 && allowedValues[0].includes('-');
    if (isRangeFilter) {
      const [min, max] = allowedValues[0].split('-').map(Number);
      const productNumbers = actualValue.match(/\d+(\.\d+)?/g)?.map(Number) || [];
      if (productNumbers.length === 0) return false;
      return productNumbers.some(n => n >= min && n <= max);
    }

    return allowedValues.includes(actualValue);
  });
}

/**
 * 比對產品是否通過規格篩選（含變體）
 */
export function productMatchesSpecFilters(
  product: any,
  selectedSpecs: Record<string, string[]>,
  getVariants: (productId: string) => any[]
): boolean {
  const specKeys = Object.keys(selectedSpecs);
  if (specKeys.length === 0) return true;

  const productMatches = matchesSpecFilters(product, selectedSpecs);
  const variants = getVariants(product.id);
  const anyVariantMatches = variants.some((v) => matchesSpecFilters(v, selectedSpecs));

  return productMatches || anyVariantMatches;
}
