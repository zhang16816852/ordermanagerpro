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

      // 0.5. 若搜尋，同時比對型號名稱（device_models + device_model_groups）
      let searchModelProductIds: string[] | null = null;
      if (search) {
        const [modelRes, groupRes] = await Promise.all([
          supabase.from("device_models").select("id").ilike("name", `%${search}%`),
          supabase.from("device_model_groups").select("id").ilike("name", `%${search}%`),
        ]);
        const modelIds = (modelRes.data || []).map((m: any) => m.id);
        const groupIds = (groupRes.data || []).map((g: any) => g.id);
        if (modelIds.length > 0 || groupIds.length > 0) {
          const orRels: string[] = [];
          if (modelIds.length > 0) orRels.push(`model_id.in.(${modelIds.join(",")})`);
          if (groupIds.length > 0) orRels.push(`group_id.in.(${groupIds.join(",")})`);
          const { data: rels } = await supabase
            .from("entity_model_relations")
            .select("product_id")
            .or(orRels.join(","));
          searchModelProductIds = [...new Set((rels || []).map((r: any) => r.product_id).filter(Boolean))];
        }
      }

      // 1. 查詢商品（含規格與分類關聯），伺服端過濾 + 分頁
      let productQuery: any = supabase
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
        const searchOr: string[] = [`name.ilike.%${search}%`, `sku.ilike.%${search}%`];
        if (searchModelProductIds && searchModelProductIds.length > 0) {
          searchOr.push(`id.in.(${searchModelProductIds.join(",")})`);
        }
        productQuery = productQuery.or(searchOr.join(","));
      }
      // brands filter: only exact match on brand_id column
      if (brands && brands.length > 0) {
        productQuery = productQuery.in("brand_id", brands);
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

      let relationsQuery = supabase.from("entity_model_relations").select("*");
      const orParts: string[] = [];
      if (productIds.length > 0) orParts.push(`product_id.in.(${productIds.join(",")})`);
      if (variantIds.length > 0) orParts.push(`variant_id.in.(${variantIds.join(",")})`);
      if (orParts.length > 0) {
        relationsQuery = relationsQuery.or(orParts.join(","));
      } else {
        relationsQuery = relationsQuery.in("product_id", ["__none__"]);
      }
      const [relationResult, groupResult, specResult, coverResult, priceResult] =
        await Promise.all([
          relationsQuery,
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

      // 只抓取 entity_model_relations 中有參照的 device_models
      const referencedModelIds = [...new Set(
        (relationResult.data || [])
          .filter((r: any) => r.model_id)
          .map((r: any) => r.model_id as string)
      )];
      const { data: deviceModelsData } = referencedModelIds.length > 0
        ? await supabase.from("device_models").select("id, name, aliases").in("id", referencedModelIds)
        : { data: [] };

      // 3. 建立 MAP
      const devModelsMap = new Map(
        (deviceModelsData || []).map((m: any) => [m.id, m])
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
            // 若變體沒有自己的型號資料，繼承自商品本體
            const inheritedModelData = (modelDataV.device_models?.length > 0 || modelDataV.device_model_groups?.length > 0)
              ? modelDataV : modelDataP;
            const variantStoreProduct = storeSettings.find(
              (sp: any) => sp.variant_id === v.id
            );
            return {
              ...v,
              ...inheritedModelData,
              image_url: coversMap.get(v.id) || null,
              effective_model_names: inheritedModelData._expanded_models,
              effective_model_aliases: inheritedModelData._expanded_model_aliases,
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
