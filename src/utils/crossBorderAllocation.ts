// src/utils/crossBorderAllocation.ts
// 前端純邏輯：落地成本分攤預覽（鏡像後端 _po_allocate_freight 的演算法，供 UI dry-run 顯示用）。
// 與後端保持相同：全程台幣、最大餘數法取整 0.01、整單校正因子、權重歸零 fallback。
// ⚠️ 最終寫入仍以後端 allocate_purchase_freight(p_apply=true) 為準，此模組僅供預覽。

export type FreightMethod =
  | 'by_quantity'
  | 'by_weight'
  | 'by_volume'
  | 'by_value'
  | 'manual';

export interface AllocItemInput {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitCost: number;
  weightKg: number | null;
  volumeM3: number | null;
  freightManualWeight: number | null;
  sortOrder: number;
  oldAllocatedFreight: number;
  oldLandedUnitCost: number | null;
}

export interface AllocItemResult {
  purchaseOrderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  weight: number;
  weightEffective: number;
  oldAllocatedFreight: number;
  newAllocatedFreight: number;
  oldLandedUnitCost: number;
  newLandedUnitCost: number;
}

export interface AllocResult {
  method: FreightMethod;
  fallback: boolean;
  warnings: string[];
  weightFactor: number;
  actualWeight: number | null;
  baseWeightTotal: number;
  freightTotalTwd: number;
  changes: AllocItemResult[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function allocateFreightPreview(
  items: AllocItemInput[],
  method: FreightMethod,
  freightTotalTwd: number,
  freightActualWeight: number | null,
): AllocResult {
  const warnings: string[] = [];
  let m: FreightMethod = method || 'by_quantity';

  // raw weight/volume per unit
  const rawWeight = (it: AllocItemInput) => (it.weightKg ?? 0);
  const rawVolume = (it: AllocItemInput) => (it.volumeM3 ?? 0);

  // 校正因子
  const sumWeightBase = items.reduce((s, it) => s + rawWeight(it) * (it.quantity || 0), 0);
  let factor = 1;
  if (freightActualWeight != null && sumWeightBase > 0) {
    factor = freightActualWeight / sumWeightBase;
  } else if (freightActualWeight != null && sumWeightBase === 0) {
    warnings.push('無重量資料，校正因子未套用');
  }

  // 逐品項權重
  const w = items.map((it) => {
    const q = it.quantity || 0;
    if (q <= 0) return 0;
    switch (m) {
      case 'by_quantity':
        return q;
      case 'by_weight':
        return rawWeight(it) * q * factor;
      case 'by_volume':
        return rawVolume(it) * q;
      case 'by_value':
        return q * (it.unitCost || 0);
      case 'manual':
        return it.freightManualWeight ?? 0;
      default:
        return q;
    }
  });

  let sumW = w.reduce((s, x) => s + x, 0);

  // 權重歸零 fallback
  let fallback = false;
  if (sumW === 0 && m !== 'by_quantity') {
    fallback = true;
    m = 'by_quantity';
    for (let i = 0; i < items.length; i++) {
      const q = items[i].quantity || 0;
      w[i] = q > 0 ? q : 0;
    }
    sumW = w.reduce((s, x) => s + x, 0);
  }
  if (sumW === 0) {
    // 平均分攤
    fallback = true;
    warnings.push('所有品項數量為 0，採平均分攤');
    for (let i = 0; i < items.length; i++) w[i] = 1;
    sumW = items.length || 1;
  }

  // 最大餘數法（整數分）
  const totalCent = Math.round(freightTotalTwd * 100);
  const baseCent = w.map((wi) => Math.floor((totalCent * wi) / sumW));
  const gapCent = totalCent - baseCent.reduce((s, x) => s + x, 0);

  const rem = w.map((wi) => (totalCent * wi) % sumW);

  // rank: rem DESC, sortOrder ASC, index ASC
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      if (rem[b] !== rem[a]) return rem[b] - rem[a];
      if (items[a].sortOrder !== items[b].sortOrder) return items[a].sortOrder - items[b].sortOrder;
      return a - b;
    });

  const isTop = new Array(items.length).fill(false);
  for (let k = 0; k < gapCent && k < order.length; k++) {
    isTop[order[k]] = true;
  }

  const allocated = items.map((_, i) => (baseCent[i] + (isTop[i] ? 1 : 0)) / 100);

  const changes: AllocItemResult[] = items.map((it, i) => {
    const newAllocated = allocated[i];
    const newLanded =
      it.quantity > 0 ? round2(it.unitCost + newAllocated / it.quantity) : it.unitCost;
    return {
      purchaseOrderItemId: it.id,
      productId: it.productId,
      variantId: it.variantId,
      quantity: it.quantity,
      weight: rawWeight(it),
      weightEffective: rawWeight(it) * factor,
      oldAllocatedFreight: it.oldAllocatedFreight,
      newAllocatedFreight: newAllocated,
      oldLandedUnitCost: it.oldLandedUnitCost ?? it.unitCost,
      newLandedUnitCost: newLanded,
    };
  });

  return {
    method: m,
    fallback,
    warnings,
    weightFactor: factor,
    actualWeight: freightActualWeight,
    baseWeightTotal: sumWeightBase,
    freightTotalTwd: freightTotalTwd,
    changes,
  };
}
