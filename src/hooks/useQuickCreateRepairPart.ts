import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { RepairPartInput } from './useRepairParts';
import { useSpecStore } from '@/store/useSpecStore';

export interface QuickCreateRepairPartInput {
  // 零件型錄
  device_model_id: string | null;
  name: string;
  tags: string[];
  description: string | null;
  supplier_id: string | null;
  default_unit_cost: number;
  default_unit_price: number;
  is_active: boolean;
  sort_order: number;
  version: string | null;
  // 規格
  category_ids: string[];  // 維修零件分類 IDs
  spec_values: Record<string, string[]>;  // 規格值
  // 庫存商品
  create_product: boolean;
  links: { product_id: string; variant_id: string | null; spec_label: string | null; is_default: boolean }[];
}

/**
 * 快速建立維修零件（完整版）
 * 1. 建立 repair_parts（零件型錄）
 * 2. 若 create_product=true，建立 products + product_variants + entity_spec_values
 * 3. 建立 repair_part_variants 連結
 */
export function useQuickCreateRepairPart() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (input: QuickCreateRepairPartInput) => {
      const db = supabase as any;

      // 1. 建立 repair_parts
      const { data: part, error: partError } = await db
        .from('repair_parts')
        .insert({
          device_model_id: input.device_model_id || null,
          name: input.name.trim(),
          tags: input.tags,
          description: input.description || null,
          supplier_id: input.supplier_id || null,
          default_unit_cost: input.default_unit_cost,
          default_unit_price: input.default_unit_price,
          is_active: input.is_active,
          sort_order: input.sort_order,
          version: input.version || null,
        })
        .select('id')
        .single();
      if (partError) throw partError;

      let productId: string | null = null;
      let variantId: string | null = null;

      // 2. 若 create_product=true，建立 products + product_variants
      if (input.create_product) {
        // 2a. 建立 product
        const productCode = `RP-${Date.now().toString(36).toUpperCase()}`;
        const { data: product, error: productError } = await db
          .from('products')
          .insert({
            name: input.name.trim(),
            code: productCode,
            item_type: 'repair_part',
            is_hidden: false,
            unified_pricing: true,
            unified_wholesale_price: input.default_unit_cost,
            unified_retail_price: input.default_unit_price,
            supplier_id: input.supplier_id || null,
          })
          .select('id')
          .single();
        if (productError) throw productError;
        productId = product.id;

        // 2b. 建立 product_variant
        const variantSku = `RPV-${Date.now().toString(36).toUpperCase()}`;
        const { data: variant, error: variantError } = await db
          .from('product_variants')
          .insert({
            product_id: productId,
            name: input.name.trim(),
            sku: variantSku,
            wholesale_price: input.default_unit_cost,
            retail_price: input.default_unit_price,
            sort_order: 0,
            tracking_mode: 'none',
          })
          .select('id')
          .single();
        if (variantError) throw variantError;
        variantId = variant.id;

        // 2c. 寫入 category links
        if (input.category_ids.length > 0) {
          const { error: catError } = await db
            .from('product_category_links')
            .insert(input.category_ids.map(catId => ({ product_id: productId, category_id: catId })));
          if (catError) throw catError;
        }

        // 2d. 寫入 entity_spec_values（規格值）
        if (Object.keys(input.spec_values).length > 0 && input.category_ids.length > 0) {
          // 轉換 spec_values 為 entity_spec_values 格式
          const specData: Record<string, any> = {};
          for (const [specName, values] of Object.entries(input.spec_values)) {
            if (values.length > 0) {
              specData[specName] = values.length === 1 ? values[0] : values;
            }
          }
          if (Object.keys(specData).length > 0) {
            const { error: specError } = await db.rpc('sync_product_specs_v6', {
              p_entity_id: productId,
              p_entity_type: 'product',
              p_category_id: input.category_ids[0],
              p_new_data: specData,
            });
            if (specError) console.warn('Spec sync warning:', specError);
          }
        }

        // 2e. Sync storefront items
        await db.rpc('sync_storefront_items', { p_product_id: productId });
      }

      // 3. 建立 repair_part_variants 連結
      const specLabelParts = [...Object.values(input.spec_values).flat()];
      if (input.version) specLabelParts.push(input.version);
      const specLabel = specLabelParts.length > 0 ? specLabelParts.join(' / ') : null;
      const linksToSave = input.create_product && productId && variantId
        ? [{ product_id: productId, variant_id: variantId, spec_label: specLabel, is_default: true }, ...input.links]
        : input.links;

      if (linksToSave.length > 0) {
        const { error: linkError } = await db
          .from('repair_part_variants')
          .insert(linksToSave.map(l => ({
            repair_part_id: part.id,
            product_id: l.product_id,
            variant_id: l.variant_id || null,
            spec_label: l.spec_label || null,
            is_default: l.is_default,
          })));
        if (linkError) throw linkError;
      }

      // 4. Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['repair-parts-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['repair-part-product-options'] });

      return { partId: part.id, productId, variantId };
    },
    onSuccess: (result) => {
      toast.success('零件已建立' + (result.productId ? '，庫存商品已同步建立' : ''));
    },
    onError: (err: any) => toast.error('建立失敗：' + getErrorMessage(err)),
  });

  return { createMutation };
}