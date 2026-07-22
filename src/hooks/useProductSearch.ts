import { useMemo } from 'react';
import { getSubCategoryIds, productMatchesSpecFilters } from '@/utils/treeUtils';

export interface ProductSearchParams {
  products: any[];
  search?: string;
  selectedCategory?: string | null;
  categoryHierarchy?: { parent_id: string; child_id: string }[];
  selectedBrands?: string[];
  selectedSeries?: string[];
  selectedDeviceModels?: string[];
  selectedSpecs?: Record<string, string[]>;
  /** 取得某產品的所有變體（供 spec filter 用） */
  getVariants?: (productId: string) => any[];
  /** 品牌 ID -> 品牌名稱 的 Map（供文字搜尋品牌名用） */
  brandMap?: Record<string, string>;
}

/**
 * 統一的產品搜尋/過濾 hook。
 * 所有過濾條件都是 client-side，資料來源是已快取的完整產品列表。
 */
export function useProductSearch({
  products,
  search = '',
  selectedCategory = null,
  categoryHierarchy = [],
  selectedBrands = [],
  selectedSeries = [],
  selectedDeviceModels = [],
  selectedSpecs = {},
  brandMap = {},
  getVariants = (id) => {
    const p = products.find((p: any) => p.id === id);
    return p?.variants || [];
  },
}: ProductSearchParams): any[] {
  // Category subcategory expansion
  const subCategoryIds = useMemo(() => {
    return getSubCategoryIds(selectedCategory, categoryHierarchy);
  }, [selectedCategory, categoryHierarchy]);

  return useMemo(() => {
    if (!products || products.length === 0) return [];

    // 1. Text search
    let result = products;
    if (search) {
      const keywords = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 0) {
        result = result.filter(p => {
          const allVariantModelNames = (p.variants || []).flatMap((v: any) => v.effective_model_names || []);
          const allVariantModelAliases = (p.variants || []).flatMap((v: any) => v.effective_model_aliases || []);
          const brandName = ((p as any).primary_brand_name || (p.brand_ids || []).map((id: string) => brandMap[id]).filter(Boolean).join(', ')) || '';

          const productTexts = [
            p.name,
            p.sku,
            p.model,
            brandName,
            ...(p.category_names || []),
            ...(p.effective_model_names || []),
            ...((p as any).effective_model_aliases || []),
            ...allVariantModelNames,
            ...allVariantModelAliases,
          ]
            .filter(Boolean)
            .map((v: string) => v.toLowerCase());

          return keywords.every(kw => productTexts.some(text => text.includes(kw)));
        });
      }
    }

    // 2. Category filter (with subcategory expansion)
    if (selectedCategory && subCategoryIds.size > 0) {
      result = result.filter(p => {
        const pCategoryIds = (p as any).category_ids || [];
        return pCategoryIds.some((id: string) => subCategoryIds.has(id));
      });
    }

    // 3. Brand filter
    if (selectedBrands.length > 0) {
      result = result.filter(p => {
        const pBrandIds = (p as any).brand_ids || [];
        return pBrandIds.some((id: string) => selectedBrands.includes(id));
      });
    }

    // 4. Series filter
    if (selectedSeries.length > 0) {
      result = result.filter(p => {
        const pSeriesIds = (p as any).brand_series_ids || [];
        return pSeriesIds.some((id: string) => selectedSeries.includes(id));
      });
    }

    // 5. Device model filter
    if (selectedDeviceModels.length > 0) {
      result = result.filter(p => {
        const pModels = (p as any).effective_model_names || [];
        const vModels = (p as any).variants?.flatMap((v: any) => v.effective_model_names || []) || [];
        const allModels = [...new Set([...pModels, ...vModels])];
        return allModels.some((m: string) => selectedDeviceModels.includes(m));
      });
    }

    // 6. Spec filter
    if (Object.keys(selectedSpecs).length > 0) {
      result = result.filter(p =>
        productMatchesSpecFilters(p, selectedSpecs, getVariants)
      );
    }

    return result;
  }, [
    products, search, subCategoryIds, selectedCategory,
    selectedBrands, selectedSeries, selectedDeviceModels, selectedSpecs,
    brandMap, getVariants,
  ]);
}
