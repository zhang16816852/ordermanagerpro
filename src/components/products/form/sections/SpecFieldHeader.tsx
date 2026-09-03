import { cn } from '@/lib/utils';
import type { CategorySpec } from '@/hooks/useCategorySpecs';
import { QTY_GROUP_PALETTE, SpecColorMap, SpecVisibleInfo, buildDepChain, resolveGroupColor } from './specFieldUi';

interface SpecFieldHeaderProps {
    spec: CategorySpec;
    pathKey: string;
    /** 目前欄位的值（heading 判斷用：'heading' 且無值 → 渲染標題） */
    value?: any;
    level?: number;
    visibleInfo: Map<string, SpecVisibleInfo>;
    colorMap: SpecColorMap;
    /** 是否顯示「依賴 ▸ …」鏈（list 用；矩陣左欄可關閉避免過擠） */
    showDepChain?: boolean;
    className?: string;
}

/**
 * 規格欄位標籤（共用）：名稱＋必填 *＋數量組別「第N組」pill＋依賴鏈，套用組別色票。
 * 供「產品規格」（DynamicSpecsFields）與「變體規格矩陣」的左側標籤欄共用，確保兩畫面一致。
 */
export function SpecFieldHeader({
    spec,
    pathKey,
    value,
    level = 0,
    visibleInfo,
    colorMap,
    showDepChain = true,
    className,
}: SpecFieldHeaderProps) {
    const info = visibleInfo.get(pathKey);
    const colorIndex = resolveGroupColor(pathKey, colorMap, visibleInfo);
    const pal = colorIndex !== null ? QTY_GROUP_PALETTE[colorIndex] : null;
    const isHeading = spec.type === 'heading' && !value;
    const depChain = buildDepChain(pathKey, visibleInfo);

    if (isHeading) {
        return (
            <div className={cn('p-0.5 rounded-md', className)}>
                <div className="py-1 border-b border-primary/10 mb-1">
                    <div className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                        <span className="w-1 h-3 bg-primary rounded-full" />
                        {spec.name}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={cn(
            'p-0.5 rounded-md transition-all',
            pal ? `border-l-2 ${pal.border} pl-3` : level > 0 ? 'border-l-2 border-primary/20 pl-3' : '',
            className
        )}>
            <label className="text-xs font-semibold text-muted-foreground flex justify-between items-center group mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    {level > 0 && <span className="text-primary/40">↳</span>}
                    <span className="truncate">
                        {spec.name}
                        {spec.required && <span className="text-destructive font-bold ml-1" title="必填">*</span>}
                    </span>
                    {pal && info?.isQuantityInstance && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${pal.pill}`}>
                            第{info.instanceIndex}組
                        </span>
                    )}
                </div>
                {showDepChain && info && !pathKey.startsWith('root:') && depChain.length > 0 && (
                    <span className="text-[10px] font-normal text-muted-foreground/70 truncate" title={depChain.join(' ▸ ')}>
                        依賴 ▸ {depChain.join(' ▸ ')}
                    </span>
                )}
            </label>
        </div>
    );
}