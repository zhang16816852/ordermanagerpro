import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { useSpecStore } from '@/store/useSpecStore';
import { useBrandSeriesCache } from '@/hooks/useBrandSeriesCache';
import { Category, CategoryHierarchy } from '../types';

// 分類綁定管理：支援產品和變體層級的分類綁定

export interface ProductBinding {
  product_id: string;
  product_name: string;
  product_sku: string;
  brand_ids: string[];
  brand_name: string;
  has_variants: boolean;
  category_ids: string[];
  variant_count: number;
}

export interface VariantBinding {
  variant_id: string;
  variant_name: string;
  variant_sku: string;
  product_id: string;
  product_name: string;
  option_1: string | null;
  option_2: string | null;
  color: string | null;
  category_ids: string[];
}

export interface ImportBindingRow {
  product_sku: string;
  variant_sku?: string;
  category_path: string;
  device_model?: string;
}

export function useCategoryBindings() {
  const queryClient = useQueryClient();
  const { categories, categoryHierarchy } = useSpecStore();

  // 取得所有品牌
  const { data: brands = [] } = useQuery({
    queryKey: ['device_brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('device_brands')
        .select('*')
        .order('name');
      if (error) throw error;
      return data || [];
    },
  });

  // 取得所有品牌系列（產品品牌的系列，如犀牛盾→CLEAR系列）
  const { allSeries: brandSeries } = useBrandSeriesCache();

  // 取得所有產品（含分類綁定）
  const { data: products = [], isLoading: isLoadingProducts } = useQuery({
    queryKey: ['products_with_bindings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, sku, has_variants, status,
          product_category_links(category_id),
          product_brands(brand_id),
          variants:product_variants(id)
        `)
        .eq('status', 'active')
        .order('name');
      if (error) throw error;

      return (data || []).map((p: any) => ({
        product_id: p.id,
        product_name: p.name,
        product_sku: p.sku,
        brand_ids: p.product_brands?.map((b: any) => b.brand_id) || [],
        brand_name: p.product_brands?.map((b: any) => brands.find((br: any) => br.id === b.brand_id)?.name).filter(Boolean).join(', ') || '',
        has_variants: p.has_variants,
        category_ids: (p.product_category_links || []).map((l: any) => l.category_id),
        variant_count: (p.variants || []).length,
      })) as ProductBinding[];
    },
    enabled: brands.length > 0,
  });

  // 取得指定產品的變體（含分類綁定）
  const fetchVariants = async (productId: string): Promise<VariantBinding[]> => {
    const { data, error } = await supabase
      .from('product_variants')
      .select(`
        id, name, sku, product_id, option_1, option_2, color,
        product_category_links(category_id)
      `)
      .eq('product_id', productId)
      .order('name');
    if (error) throw error;

    const product = products.find(p => p.product_id === productId);

    return (data || []).map((v: any) => ({
      variant_id: v.id,
      variant_name: v.name,
      variant_sku: v.sku,
      product_id: v.product_id,
      product_name: product?.product_name || '',
      option_1: v.option_1,
      option_2: v.option_2,
      color: v.color,
      category_ids: (v.product_category_links || []).map((l: any) => l.category_id),
    }));
  };

  // 更新產品的分類綁定
  const updateProductBinding = useMutation({
    mutationFn: async ({ productId, categoryIds }: { productId: string; categoryIds: string[] }) => {
      // 先刪除舊的綁定
      await supabase
        .from('product_category_links')
        .delete()
        .eq('product_id', productId)
        .is('variant_id', null);

      // 插入新的綁定
      if (categoryIds.length > 0) {
        const links = categoryIds.map(catId => ({
          product_id: productId,
          category_id: catId,
        }));
        const { error } = await supabase
          .from('product_category_links')
          .insert(links);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_with_bindings'] });
      toast.success('分類綁定已更新');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 更新變體的分類綁定
  const updateVariantBinding = useMutation({
    mutationFn: async ({ variantId, categoryIds }: { variantId: string; categoryIds: string[] }) => {
      // 先刪除舊的綁定
      await supabase
        .from('product_category_links')
        .delete()
        .eq('variant_id', variantId);

      // 插入新的綁定
      if (categoryIds.length > 0) {
        const links = categoryIds.map(catId => ({
          variant_id: variantId,
          category_id: catId,
        }));
        const { error } = await supabase
          .from('product_category_links')
          .insert(links);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_with_bindings'] });
      toast.success('變體分類綁定已更新');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // 批次匯入分類綁定
  const batchImportBindings = useMutation({
    mutationFn: async (rows: ImportBindingRow[]) => {
      let successCount = 0;
      let errorCount = 0;

      for (const row of rows) {
        try {
          // 解析分類路徑
          const categoryIds = resolveCategoryPath(row.category_path, categories, categoryHierarchy);
          if (categoryIds.length === 0) {
            errorCount++;
            continue;
          }

          // 找到產品
          const product = products.find(p => p.product_sku === row.product_sku);
          if (!product) {
            errorCount++;
            continue;
          }

          // 綁定分類
          if (row.variant_sku) {
            // 變體層級綁定
            const { data: variant } = await supabase
              .from('product_variants')
              .select('id')
              .eq('sku', row.variant_sku)
              .single();
            
            if (variant) {
              await supabase
                .from('product_category_links')
                .delete()
                .eq('variant_id', variant.id);
              
              if (categoryIds.length > 0) {
                const links = categoryIds.map(catId => ({
                  variant_id: variant.id,
                  category_id: catId,
                }));
                await supabase.from('product_category_links').insert(links);
              }
              successCount++;
            } else {
              errorCount++;
            }
          } else {
            // 產品層級綁定
            await supabase
              .from('product_category_links')
              .delete()
              .eq('product_id', product.product_id)
              .is('variant_id', null);
            
            if (categoryIds.length > 0) {
              const links = categoryIds.map(catId => ({
                product_id: product.product_id,
                category_id: catId,
              }));
              await supabase.from('product_category_links').insert(links);
            }
            successCount++;
          }
        } catch {
          errorCount++;
        }
      }

      return { successCount, errorCount };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['products_with_bindings'] });
      toast.success(`匯入完成：成功 ${result.successCount} 筆，失敗 ${result.errorCount} 筆`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return {
    brands,
    brandSeries,
    products,
    isLoadingProducts,
    fetchVariants,
    updateProductBinding,
    updateVariantBinding,
    batchImportBindings,
    categories,
    categoryHierarchy,
  };
}

// 解析分類路徑（例如「玻璃保護貼/康寧系列」）
function resolveCategoryPath(
  path: string,
  categories: Category[],
  hierarchy: CategoryHierarchy[]
): string[] {
  const parts = path.split('/').map(p => p.trim()).filter(Boolean);
  const result: string[] = [];
  let currentParentId: string | null = null;

  for (const part of parts) {
    // 找到符合名稱的分類
    const match = categories.find(c => {
      const nameMatch = c.name === part;
      if (!nameMatch) return false;
      if (currentParentId === null) {
        // 根層級：不應該有父節點
        return !hierarchy.some(h => h.child_id === c.id);
      }
      // 子層級：必須有正確的父節點
      return hierarchy.some(h => h.parent_id === currentParentId && h.child_id === c.id);
    });

    if (match) {
      result.push(match.id);
      currentParentId = match.id;
    } else {
      // 嘗試不檢查父節點（容錯）
      const fallback = categories.find(c => c.name === part);
      if (fallback) {
        result.push(fallback.id);
        currentParentId = fallback.id;
      }
    }
  }

  return result;
}
