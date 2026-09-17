import { supabase } from '@/integrations/supabase/client';

export interface VariantReference {
  variant_id: string;
  variant_sku: string;
  table: string;
  label: string;
  count: number;
}

export interface ReferenceCheckResult {
  ok: boolean;
  referenced: VariantReference[];
}

const TABLE_LABELS: Record<string, string> = {
  order_items: '訂單品項',
  purchase_order_items: '採購單品項',
  inventory_movements: '庫存異動',
  product_inventory: '庫存紀錄',
  consignment_order_items: '寄賣單品項',
  repair_order_items: '維修單品項',
  supplier_product_mappings: '供應商映射',
};

export async function checkVariantReferences(
  variantIds: string[],
): Promise<ReferenceCheckResult> {
  if (variantIds.length === 0) return { ok: true, referenced: [] };

  const referenced: VariantReference[] = [];

  const [
    orderItems,
    purchaseOrderItems,
    inventoryMovements,
    productInventory,
    consignmentOrderItems,
    repairOrderItems,
    supplierMappings,
  ] = await Promise.all([
    supabase
      .from('order_items')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('purchase_order_items')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('inventory_movements')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('product_inventory')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('consignment_order_items')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('repair_order_items')
      .select('variant_id')
      .in('variant_id', variantIds),
    supabase
      .from('supplier_product_mappings')
      .select('internal_variant_id')
      .in('internal_variant_id', variantIds),
  ]);

  const countByTable = (rows: Record<string, unknown>[] | null, key: string) => {
    const map = new Map<string, number>();
    rows?.forEach(r => {
      const id = r[key];
      if (id != null && typeof id === 'string') map.set(id, (map.get(id) || 0) + 1);
    });
    return map;
  };

  const counts = [
    { table: 'order_items', map: countByTable(orderItems.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'purchase_order_items', map: countByTable(purchaseOrderItems.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'inventory_movements', map: countByTable(inventoryMovements.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'product_inventory', map: countByTable(productInventory.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'consignment_order_items', map: countByTable(consignmentOrderItems.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'repair_order_items', map: countByTable(repairOrderItems.data as Record<string, unknown>[] | null, 'variant_id') },
    { table: 'supplier_product_mappings', map: countByTable(supplierMappings.data as Record<string, unknown>[] | null, 'internal_variant_id') },
  ];

  for (const { table, map } of counts) {
    if (map.size === 0) continue;
    const label = TABLE_LABELS[table] || table;
    for (const [variantId, count] of map) {
      referenced.push({ variant_id: variantId, variant_sku: '', table, label, count });
    }
  }

  if (referenced.length > 0) {
    const skuIds = [...new Set(referenced.map(r => r.variant_id))];
    const { data: variants } = await supabase
      .from('product_variants')
      .select('id, sku')
      .in('id', skuIds);
    const skuMap = new Map(variants?.map(v => [v.id, v.sku]) || []);
    referenced.forEach(r => { r.variant_sku = skuMap.get(r.variant_id) || ''; });
  }

  return {
    ok: referenced.length === 0,
    referenced,
  };
}

export function groupReferencesByVariant(referenced: VariantReference[]) {
  const byVariant = new Map<string, { sku: string; tables: typeof referenced }>();
  for (const ref of referenced) {
    const existing = byVariant.get(ref.variant_id);
    if (existing) {
      existing.tables.push(ref);
    } else {
      byVariant.set(ref.variant_id, { sku: ref.variant_sku, tables: [ref] });
    }
  }
  return byVariant;
}
