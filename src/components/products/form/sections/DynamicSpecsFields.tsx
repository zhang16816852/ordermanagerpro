import { useEffect, useMemo } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { SpecValueEditor } from './SpecValueEditor';
import { SpecFieldHeader } from './SpecFieldHeader';
import { QTY_GROUP_PALETTE, buildQuantityColorMap, resolveGroupColor } from './specFieldUi';
import { getVisibleSpecsTree, getTreeSortedVisiblePaths } from '@/utils/specLogic';
import { useCategorySpecs, CategorySpec } from '@/hooks/useCategorySpecs';
import { useSpecStore } from '@/store/useSpecStore';

interface DynamicSpecsFieldsProps {
    form: UseFormReturn<any>;
    specFieldsOverride?: CategorySpec[];
}

export function DynamicSpecsFields({ form, specFieldsOverride }: DynamicSpecsFieldsProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];
    const { specMap, specTriggers, refreshIfStale, categories } = useSpecStore();
    const { data: hookedSpecs = [], isLoading: isLoadingSpecs } = useCategorySpecs(selectedCategoryIds, {
        includeDescendants: true,
        includeTriggerDownstream: true,
    });
    const specFields = specFieldsOverride ?? hookedSpecs;
    const specValues = form.watch('spec_values') || {};

    // 確保規格定義已載入（比對版本、落後才重抓）
    useEffect(() => {
        refreshIfStale();
    }, []);

    // 使用中央計算器 (v5.1 支持 DSL)
    const visibleInfo = getVisibleSpecsTree(specFields, specValues, specTriggers);

    const sortedVisible = getTreeSortedVisiblePaths(specFields, visibleInfo);

    // 依來源分類分組（多分類選取時標示規格歸屬）
    const grouped = useMemo(() => {
        if (sortedVisible.length === 0) return [];
        const catNameMap = new Map((categories || []).map((c: any) => [c.id, c.name]));
        const seen = new Set<string>();
        const groups: { categoryId: string | null; categoryName: string; rows: { pathKey: string; level: number }[] }[] = [];

        (selectedCategoryIds || []).forEach(catId => {
            const rows = sortedVisible.filter(r => {
                const specId = r.pathKey.split(':')[1];
                const spec = specFields.find(f => f.id === specId);
                return (spec?.sourceCategoryIds || []).includes(catId) && !seen.has(r.pathKey);
            });
            if (rows.length === 0) return;
            rows.forEach(r => seen.add(r.pathKey));
            groups.push({ categoryId: catId, categoryName: catNameMap.get(catId) || '分類', rows });
        });

        const remaining = sortedVisible.filter(r => !seen.has(r.pathKey));
        if (remaining.length > 0) {
            remaining.forEach(r => seen.add(r.pathKey));
            groups.push({ categoryId: null, categoryName: '其他規格', rows: remaining });
        }
        return groups;
    }, [sortedVisible, selectedCategoryIds, categories, specFields]);

    // 為每個數量實例組別解析顏色：直接實例取自身 instanceIndex，子孫向上回溯繼承所屬組別顏色
    const colorMap = useMemo(() => buildQuantityColorMap(visibleInfo), [visibleInfo]);

    if (isLoadingSpecs && !specFieldsOverride) return <div className="py-4 text-center" role="status" aria-live="polite">正在載入規格...</div>;

    if (specMap.size === 0 && specFields.length > 0) {
        return <div className="py-4 text-center text-muted-foreground">正在初始化規格字典...</div>;
    }

    if (!specFields || specFields.length === 0) return null;

    const groupedEl = (
        <div className="space-y-6">
            {grouped.map(group => (
                <div key={group.categoryId || 'other'} className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-foreground/80 uppercase tracking-wide border-b border-primary/10 pb-1">
                        <span className="w-1.5 h-4 bg-primary/60 rounded-full" />
                        {group.categoryName}
                        <span className="text-[10px] font-normal text-muted-foreground normal-case">{group.rows.length} 項規格</span>
                    </div>
                    <div className="space-y-4">
                        {group.rows.map(({ pathKey, level }) => {
                            const parts = pathKey.split(':');
                            const specId = parts[1];
                            const spec = specFields.find(f => f.id === specId) || specMap.get(specId);

                            if (!spec) return null;

                            const value = specValues[pathKey] || '';
                            const info = visibleInfo.get(pathKey);
                            const ci = resolveGroupColor(pathKey, colorMap, visibleInfo);
                            const pal = ci !== null ? QTY_GROUP_PALETTE[ci] : null;
                            const isHeading = spec.type === 'heading' && !value;

                            return (
                                <div
                                    key={pathKey}
                                    style={{ marginLeft: `${level * 16}px` }}
                                    className={`space-y-2 animate-in fade-in slide-in-from-left-2 duration-300 ${pal ? pal.tint + ' rounded-md' : ''}`}
                                >
                                    <SpecFieldHeader
                                        spec={spec}
                                        pathKey={pathKey}
                                        value={value}
                                        level={level}
                                        visibleInfo={visibleInfo}
                                        colorMap={colorMap}
                                    />
                                    {!isHeading && (
                                        <SpecValueEditor
                                            spec={spec}
                                            value={value}
                                            onChange={(val) => form.setValue(`spec_values.${pathKey}`, val, { shouldDirty: true })}
                                            sourceValue={info?.sourceValue}
                                            isQuantityDetail={info?.isQuantityDetail}
                                            variantMode={false}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
                分類特定規格
            </h3>
            {colorMap.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>數量組別：</span>
                    {Array.from({ length: Math.min(colorMap.size, QTY_GROUP_PALETTE.length) }).map((_, i) => (
                        <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${QTY_GROUP_PALETTE[i].pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${QTY_GROUP_PALETTE[i].dot}`} />第{i + 1}組
                        </span>
                    ))}
                </div>
            )}
            {groupedEl}
        </div>
    );
}
