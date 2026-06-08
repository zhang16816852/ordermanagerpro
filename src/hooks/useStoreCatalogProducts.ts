import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProductWithPricing, VariantWithPricing } from "@/types/product";

const PAGE_SIZE = 24;

interface CatalogOptions {
  storeId: string;
  categoryId?: string | null;
  subCategoryIds?: string[];
  search?: string;
  brands?: string[];
  page?: number;
}

interface CatalogResult {
  products: ProductWithPricing[];
  totalCount: number;
  page: number;
  totalPages: number;
  isLoading: boolean;
}

export function useStoreCatalogProducts({
  storeId,
  categoryId,
  subCategoryIds,
  search,
  brands,
  page = 1,
}: CatalogOptions): CatalogResult {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, isLoading } = useQuery({
    queryKey: ["store-catalog", storeId, categoryId, subCategoryIds, search, brands, page],
    queryFn: async () => {
      // 0. 先取得符合子分類的商品 ID（避開 PostgREST nested .in() 問題）
      let categoryProductIds: string[] | null = null;
      if (subCategoryIds && subCategoryIds.length > 0) {
        const { data: links } = await supabase
          .from("product_category_links")
          .select("product_id")
          .in("category_id", subCategoryIds);
        categoryProductIds = [...new Set((links || []).map((l: any) => l.product_id))];
      }

      // 1. 查詢商品（含規格與分類關聯），伺服端過濾 + 分頁
      let productQuery = supabase
        .from("products")
        .select(
          `
          *,
          variants:product_variants(*),
          product_category_links(category_id)
        `,
          { count: "exact" }
        )
        .range(from, to);

      if (categoryProductIds !== null) {
        if (categoryProductIds.length > 0) {
          productQuery = productQuery.in("id", categoryProductIds);
        } else {
          productQuery = productQuery.in("id", ["__none__"]);
        }
      } else if (categoryId) {
        productQuery = productQuery.eq("product_category_links.category_id", categoryId);
      }
      if (search) {
        productQuery = productQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
      }
      // brands filter: only exact match on brand column
      if (brands && brands.length > 0) {
        productQuery = productQuery.in("brand", brands);
      }

      const { data: products, count: totalCount, error: productsError } = await productQuery;
      if (productsError) throw productsError;

      if (!products || products.length === 0) {
        return { products: [], totalCount: 0 };
      }

      // 2. 只抓取這些商品的關聯資料
      const productIds = products.map((p: any) => p.id);
      const variantIds = products.flatMap((p: any) => (p.variants || []).map((v: any) => v.id));
      const allEntityIds = [...productIds, ...variantIds];

      const [relationResult, modelResult, groupResult, specResult, coverResult, priceResult] =
        await Promise.all([
          supabase
            .from("entity_model_relations")
            .select("*")
            .in("product_id", productIds.length > 0 ? productIds : ["__none__"]),
          supabase.from("device_models").select("id, name, aliases"),
          supabase
            .from("device_model_groups")
            .select("id, name, device_model_group_items(device_models(id, name, aliases))"),
          supabase
            .from("entity_spec_values")
            .select("*")
            .in("entity_id", allEntityIds.length > 0 ? allEntityIds : ["__none__"]),
          supabase
            .from("product_images")
            .select("entity_type, entity_id, url")
            .eq("is_cover", true)
            .in("entity_id", allEntityIds.length > 0 ? allEntityIds : ["__none__"]),
          supabase.from("store_products").select("*"),
        ]);

      // 3. 建立 MAP
      const devModelsMap = new Map(
        (modelResult.data || []).map((m: any) => [m.id, m])
      );
      const devGroupsMap = new Map(
        (groupResult.data || []).map((g: any) => [g.id, g])
      );

      const linksMap = new Map<string, any[]>();
      const groupsMap = new Map<string, any[]>();
      const exclusionsMap = new Map<string, any[]>();
      (relationResult.data || []).forEach((r: any) => {
        const entityId = r.product_id || r.variant_id;
        if (!entityId) return;
        if (r.relation_type === "include") {
          if (r.model_id) {
            if (!linksMap.has(entityId)) linksMap.set(entityId, []);
            linksMap.get(entityId)!.push({
              entity_id: entityId,
              model_id: r.model_id,
              device_models: devModelsMap.get(r.model_id),
            });
          }
          if (r.group_id) {
            if (!groupsMap.has(entityId)) groupsMap.set(entityId, []);
            groupsMap.get(entityId)!.push({
              entity_id: entityId,
              group_id: r.group_id,
              device_model_groups: devGroupsMap.get(r.group_id),
            });
          }
        } else if (r.relation_type === "exclude") {
          if (!exclusionsMap.has(entityId)) exclusionsMap.set(entityId, []);
          exclusionsMap.get(entityId)!.push({
            entity_id: entityId,
            model_id: r.model_id,
            device_models: devModelsMap.get(r.model_id),
          });
        }
      });

      const specsMap = new Map<string, Record<string, any>>();
      (specResult.data || []).forEach((sv: any) => {
        if (!specsMap.has(sv.entity_id)) specsMap.set(sv.entity_id, {});
        const entitySpecs = specsMap.get(sv.entity_id)!;
        const parentId = sv.parent_id || "root";
        const pathKey = `${parentId}:${sv.spec_id}:${sv.instance_uuid}`;
        entitySpecs[pathKey] = sv.value;
      });

      const coversMap = new Map<string, string>();
      (coverResult.data || []).forEach((img: any) => {
        coversMap.set(img.entity_id, img.url);
      });

      // 4. 處理 product model relations
      const processModels = (entityId: string) => {
        const directLinks = linksMap.get(entityId) || [];
        const exclusionLinks = exclusionsMap.get(entityId) || [];
        const groupLinks = groupsMap.get(entityId) || [];

        const exclusions = new Set<string>();
        exclusionLinks.forEach((l: any) => {
          if (l.device_models) exclusions.add(l.device_models.id);
        });

        const directModels = directLinks
          .filter((l: any) => l.device_models && !exclusions.has(l.device_models.id))
          .map((l: any) => l.device_models);

        const expandedFromGroups: any[] = [];
        const groups: any[] = [];
        groupLinks.forEach((link: any) => {
          const group = link.device_model_groups;
          if (group) {
            const groupItems = (group.device_model_group_items || [])
              .map((item: any) => {
                if (item.device_models && !exclusions.has(item.device_models.id)) {
                  expandedFromGroups.push(item.device_models);
                  return { id: item.device_models.id, name: item.device_models.name };
                }
                return null;
              })
              .filter(Boolean);

            groups.push({ id: group.id, name: group.name, items: groupItems });
          }
        });

        return {
          device_models: directModels,
          device_model_groups: groups,
          device_model_rules: [],
          _expanded_models: Array.from(
            new Set([...directModels, ...expandedFromGroups].map((m: any) => m.name))
          ),
          _expanded_model_aliases: Array.from(
            new Set(
              [...directModels, ...expandedFromGroups].flatMap(
                (m: any) => m.aliases || []
              )
            )
          ),
          device_model_exclusions: Array.from(exclusions),
        };
      };

      // 5. 合併 store_products 定價
      const storeProductsData = priceResult.data || [];
      const processedProducts: ProductWithPricing[] = products.map((p: any) => {
        const modelDataP = processModels(p.id);
        const storeSettings = storeProductsData.filter(
          (sp: any) => sp.product_id === p.id
        );
        const mainStoreProduct = storeSettings.find((sp: any) => !sp.variant_id);

        return {
          ...p,
          ...modelDataP,
          image_url: coversMap.get(p.id) || null,
          category_ids:
            p.product_category_links?.map((l: any) => l.category_id) || [],
          effective_model_names: modelDataP._expanded_models,
          effective_model_aliases: modelDataP._expanded_model_aliases,
          spec_values: specsMap.get(p.id) || {},
          wholesale_price:
            mainStoreProduct?.wholesale_price || p.base_wholesale_price || 0,
          retail_price:
            mainStoreProduct?.retail_price || p.base_retail_price || 0,
          has_store_price: !!mainStoreProduct,
          variants: (p.variants || []).map((v: any) => {
            const modelDataV = processModels(v.id);
            const variantStoreProduct = storeSettings.find(
              (sp: any) => sp.variant_id === v.id
            );
            return {
              ...v,
              ...modelDataV,
              image_url: coversMap.get(v.id) || null,
              effective_model_names: modelDataV._expanded_models,
              effective_model_aliases: modelDataV._expanded_model_aliases,
              spec_values: specsMap.get(v.id) || {},
              effective_wholesale_price:
                variantStoreProduct?.wholesale_price ||
                v.wholesale_price ||
                p.base_wholesale_price ||
                0,
              effective_retail_price:
                variantStoreProduct?.retail_price ||
                v.retail_price ||
                p.base_retail_price ||
                0,
              has_brand_price: !!variantStoreProduct,
            } as VariantWithPricing;
          }),
        } as ProductWithPricing;
      });

      return { products: processedProducts, totalCount: totalCount || 0 };
    },
  });

  const totalPages = Math.max(1, Math.ceil((data?.totalCount || 0) / PAGE_SIZE));

  return useMemo(
    () => ({
      products: data?.products || [],
      totalCount: data?.totalCount || 0,
      page,
      totalPages,
      isLoading,
    }),
    [data, page, totalPages, isLoading]
  );
}
