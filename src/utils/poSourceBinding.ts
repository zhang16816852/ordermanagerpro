import type { PoCreateItemPayload, PoUpdateItemPayload } from "@/pages/admin/purchase-orders/types";

export interface SourceAggregatableItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string;
  quantity: number;
  maxQuantity: number;
  sourceOrderIds?: string[];
  sourceQuantities?: Record<string, number>;
  unitCost?: number;
}

export interface ExistingPoItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_cost: number;
  source_order_ids?: string[] | null;
  source_quantities?: Record<string, number> | null;
}

/**
 * 解析採購品項單價：優先採購商對照價（vendor_unit_cost），無則回退預設單價。
 */
export function resolveItemUnitCost(
  productId: string,
  variantId: string | null,
  fallbackCost: number,
  supplierMappings: Array<{
    internal_product_id: string;
    internal_variant_id: string | null;
    vendor_unit_cost: number | null;
    is_primary?: boolean;
    updated_at?: string;
    created_at?: string;
  }>
): number {
  const match = supplierMappings.find(
    (m) =>
      m.internal_product_id === productId &&
      (m.internal_variant_id === variantId || (!m.internal_variant_id && !variantId))
  );
  if (match && match.vendor_unit_cost !== null && match.vendor_unit_cost !== undefined) {
    return Number(match.vendor_unit_cost);
  }
  return fallbackCost;
}

/**
 * 合併新選取的聚合品項與現有採購單品項
 */
export function mergeItemsForExistingPO(
  existingItems: ExistingPoItem[],
  newEditableItems: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number;
    sourceOrderIds?: string[];
    sourceQuantities?: Record<string, number>;
  }>
): PoUpdateItemPayload[] {
  const map = new Map<string, {
    id: string | null;
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number;
    sourceOrderIds: Set<string>;
    sourceQuantities: Record<string, number>;
  }>();

  // 1. 放入既有品項
  for (const item of existingItems) {
    const key = `${item.product_id}_${item.variant_id || 'base'}`;
    const srcIds = item.source_order_ids || [];
    const srcQtys = item.source_quantities || {};
    map.set(key, {
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      quantity: item.quantity,
      unitCost: item.unit_cost,
      sourceOrderIds: new Set(srcIds),
      sourceQuantities: { ...srcQtys },
    });
  }

  // 2. 合併新項目
  for (const item of newEditableItems) {
    const key = `${item.productId}_${item.variantId || 'base'}`;
    const existing = map.get(key);

    if (existing) {
      existing.quantity += item.quantity;
      if (item.unitCost > 0 && existing.unitCost <= 0) {
        existing.unitCost = item.unitCost;
      }
      if (item.sourceOrderIds) {
        for (const id of item.sourceOrderIds) {
          existing.sourceOrderIds.add(id);
        }
      }
      if (item.sourceQuantities) {
        for (const [orderId, qty] of Object.entries(item.sourceQuantities)) {
          existing.sourceQuantities[orderId] = (existing.sourceQuantities[orderId] || 0) + qty;
        }
      }
    } else {
      map.set(key, {
        id: null, // 新品項
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        sourceOrderIds: new Set(item.sourceOrderIds || []),
        sourceQuantities: { ...(item.sourceQuantities || {}) },
      });
    }
  }

  // 3. 轉回 PoUpdateItemPayload 陣列
  const result: PoUpdateItemPayload[] = [];
  for (const entry of map.values()) {
    const sourceOrderIds = Array.from(entry.sourceOrderIds);
    result.push({
      id: entry.id,
      product_id: entry.productId,
      variant_id: entry.variantId,
      quantity: entry.quantity,
      unit_cost: entry.unitCost,
      source_order_ids: sourceOrderIds.length > 0 ? sourceOrderIds : null,
      source_quantities: Object.keys(entry.sourceQuantities).length > 0 ? entry.sourceQuantities : null,
    });
  }

  return result;
}

/**
 * 將編輯中清單轉為 create 側 payload
 */
export function toCreatePayloadItems(
  editableItems: Array<{
    productId: string;
    variantId: string | null;
    quantity: number;
    unitCost: number;
    sourceOrderIds?: string[];
    sourceQuantities?: Record<string, number>;
  }>
): PoCreateItemPayload[] {
  return editableItems.map((item) => {
    const sourceOrderIds = item.sourceOrderIds || [];
    return {
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: item.quantity,
      unit_cost: item.unitCost,
      source_order_ids: sourceOrderIds.length > 0 ? sourceOrderIds : null,
      source_quantities: item.sourceQuantities && Object.keys(item.sourceQuantities).length > 0 ? item.sourceQuantities : null,
    };
  });
}
