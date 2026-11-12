import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 公開型錄資料來源
 * ------------------------------------------------------------
 * 只走 get_public_categories / get_public_products 兩支 SECURITY DEFINER RPC。
 * 刻意「不」直接讀 products / product_variants：那些表的 anon 讀取路徑
 * 與 RLS 目前不成溫（有效 policy 只給 authenticated），而且直讀會讓
 * 成本欄位（wholesale_price / unified_wholesale_price）有外洩風險。
 *
 * ⚠️ nullability：typegen 對 function 回傳欄位一律標成 non-null，但實際上
 *    variant_name / model_name / brand_name / category_* / retail_price /
 *    image_url 在 DB 都可以是 NULL。這裡一律以 nullable 宣告並防禦處理。
 */

export type PublicCategory = {
  id: string;
  slug: string | null;
  name: string;
  product_count: number;
};

export type PublicProduct = {
  product_id: string;
  item_id: string;
  item_slug: string;
  product_name: string;
  variant_name: string | null;
  model_name: string | null;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  brand_name: string | null;
  retail_price: number | null;
  image_url: string | null;
  product_code: string | null;
  variant_sku: string | null;
  variant_barcode: string | null;
  spec_values: Record<string, any> | null;
};

export type PublicCategoryNode = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  sort_order: number | null;
  product_count: number;
};

export type PublicBrand = {
  id: string;
  name: string;
  product_count: number;
};

export type PublicBrandSeries = {
  brand_id: string;
  brand_name: string;
  series_id: string;
  series_name: string;
  product_count: number;
};

export type PublicDeviceModel = {
  id: string;
  name: string;
  brand_id: string | null;
  brand_name: string | null;
  product_count: number;
};

export type PublicSpecOption = {
  spec_id: string;
  spec_name: string;
  spec_type: string;
  distinct_values: any[];
};

const STALE_MS = 5 * 60 * 1000;

export function usePublicCategories() {
  return useQuery({
    queryKey: ["public-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_categories");
      if (error) throw error;
      return (data ?? []) as PublicCategory[];
    },
    staleTime: STALE_MS,
  });
}

export type PublicProductsParams = {
  categoryId?: string;
  productIds?: string[];
  limit?: number;
  distinctProducts?: boolean;
  search?: string;
  brandIds?: string[];
  modelIds?: string[];
};

export function usePublicProducts({
  categoryId,
  productIds,
  limit = 12,
  distinctProducts = true,
  search,
  brandIds,
  modelIds,
}: PublicProductsParams = {}) {
  return useQuery({
    queryKey: [
      "public-products",
      categoryId ?? null,
      productIds?.length ? [...productIds].sort().join(",") : null,
      limit,
      distinctProducts,
      search ?? null,
      brandIds?.length ? [...brandIds].sort().join(",") : null,
      modelIds?.length ? [...modelIds].sort().join(",") : null,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_public_products", {
        p_category_id: categoryId?.trim() ? categoryId : undefined,
        p_product_ids: productIds?.length ? productIds : undefined,
        p_limit: limit,
        p_distinct_products: distinctProducts,
        p_search: search?.trim() ? search.trim() : undefined,
        p_brand_ids: brandIds?.length ? brandIds : undefined,
        p_model_ids: modelIds?.length ? modelIds : undefined,
      });
      if (error) throw error;
      return (data ?? []) as PublicProduct[];
    },
    staleTime: STALE_MS,
  });
}

export function usePublicCategoryTree() {
  return useQuery({
    queryKey: ["public-category-tree"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_category_tree");
      if (error) throw error;
      return (data ?? []) as PublicCategoryNode[];
    },
    staleTime: STALE_MS,
  });
}

export function usePublicBrands() {
  return useQuery({
    queryKey: ["public-brands"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_brands");
      if (error) throw error;
      return (data ?? []) as PublicBrand[];
    },
    staleTime: STALE_MS,
  });
}

export function usePublicBrandSeries() {
  return useQuery({
    queryKey: ["public-brand-series"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_brand_series");
      if (error) throw error;
      return (data ?? []) as PublicBrandSeries[];
    },
    staleTime: STALE_MS,
  });
}

export function usePublicDeviceModels() {
  return useQuery({
    queryKey: ["public-device-models"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_device_models");
      if (error) throw error;
      return (data ?? []) as PublicDeviceModel[];
    },
    staleTime: STALE_MS,
  });
}

export function usePublicSpecOptions(categoryId?: string | null) {
  return useQuery({
    queryKey: ["public-spec-options", categoryId ?? null],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_public_spec_options", {
        p_category_id: categoryId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as PublicSpecOption[];
    },
    staleTime: STALE_MS,
  });
}