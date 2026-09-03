import type { CategorySpec } from '@/hooks/useCategorySpecs';

// 數量複製組別配色（依 instanceIndex 循環）：讓甲1 / 乙1 等各組在表單中明顯區隔
export const QTY_GROUP_PALETTE = [
  { border: 'border-rose-400', tint: 'bg-rose-500/10', pill: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
  { border: 'border-amber-400', tint: 'bg-amber-500/10', pill: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { border: 'border-emerald-400', tint: 'bg-emerald-500/10', pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { border: 'border-sky-400', tint: 'bg-sky-500/10', pill: 'bg-sky-100 text-sky-700', dot: 'bg-sky-500' },
  { border: 'border-violet-400', tint: 'bg-violet-500/10', pill: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  { border: 'border-fuchsia-400', tint: 'bg-fuchsia-500/10', pill: 'bg-fuchsia-100 text-fuchsia-700', dot: 'bg-fuchsia-500' },
];

export type SpecVisibleInfo = {
  sourceValue?: any;
  sourceName?: string;
  triggerInfo?: any;
  isQuantityDetail?: boolean;
  isQuantityInstance?: boolean;
  instanceIndex?: number;
  parentPathKey?: string;
};

/**
 * 依賴鏈組裝：沿 parentPathKey 向上回溯，組合「依賴 ▸ 來源規格 = 值」的字串片段
 */
export function buildDepChain(pathKey: string, visibleInfo: Map<string, SpecVisibleInfo>): string[] {
    const segs: string[] = [];
    let pk: string | undefined = pathKey;
    while (pk && !pk.startsWith('root:')) {
        const info = visibleInfo.get(pk);
        if (!info) break;
        if (info.isQuantityInstance) {
            segs.unshift(`第${info.instanceIndex}組·${info.sourceName}`);
        } else if (info.triggerInfo?.on_value) {
            const tVal = info.triggerInfo.on_value === 'input' ? '自訂輸入' : info.triggerInfo.on_value;
            segs.unshift(`${info.sourceName} = ${tVal}`);
        } else if (info.sourceName) {
            segs.unshift(info.sourceName);
        }
        pk = info.parentPathKey;
    }
    return segs;
}

export type SpecColorMap = Map<string, number>;

/**
 * 由 visibleInfo 事先建出「數量實例 pathKey → 色票索引」對照表（避免每次查詢都重算）
 */
export function buildQuantityColorMap(visibleInfo: Map<string, SpecVisibleInfo>): SpecColorMap {
    const m = new Map<string, number>();
    visibleInfo.forEach((info, pk) => {
        if (info?.isQuantityInstance && info.instanceIndex) {
            const ci = ((info.instanceIndex - 1) % QTY_GROUP_PALETTE.length + QTY_GROUP_PALETTE.length) % QTY_GROUP_PALETTE.length;
            m.set(pk, ci);
        }
    });
    return m;
}

/**
 * 解析某個 pathKey 的組別色票索引：直接實例取自身 instanceIndex，子孫向上回溯繼承所屬組別顏色
 */
export function resolveGroupColor(
    pathKey: string,
    colorMap: SpecColorMap,
    visibleInfo: Map<string, SpecVisibleInfo>
): number | null {
    let cur: string | undefined = pathKey;
    let guard = 0;
    while (cur && guard < 30) {
        const ci = colorMap.get(cur);
        if (ci !== undefined) return ci;
        cur = visibleInfo.get(cur)?.parentPathKey;
        guard++;
    }
    return null;
}

export function isHeadingSpec(spec: CategorySpec | undefined, value: any): boolean {
    return !!spec && spec.type === 'heading' && !value;
}