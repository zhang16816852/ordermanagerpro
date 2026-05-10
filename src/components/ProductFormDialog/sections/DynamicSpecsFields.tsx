import { useEffect } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { SpecValueEditor } from './SpecValueEditor';
import { getVisibleSpecsTree, getTreeSortedVisiblePaths } from '@/utils/specLogic';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { useSpecStore } from '@/store/useSpecStore';

interface DynamicSpecsFieldsProps {
    form: UseFormReturn<any>;
}

export function DynamicSpecsFields({ form }: DynamicSpecsFieldsProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];
    const { specMap, specTriggers, fetchSpecs } = useSpecStore();
    const { data: specFields = [], isLoading: isLoadingSpecs } = useCategorySpecs(selectedCategoryIds);
    const specValues = form.watch('spec_values') || {};

    // 確保規格定義已載入
    useEffect(() => {
        fetchSpecs();
    }, []);

    // 使用中央計算器 (v5.1 支持 DSL)
    const visibleInfo = getVisibleSpecsTree(specFields, specValues, specTriggers);

    if (isLoadingSpecs) return <div className="py-4 text-center">正在載入規格...</div>;
    
    // 如果規格定義 Map 還沒載入好，先顯示提示
    if (specMap.size === 0 && specFields.length > 0) {
        return <div className="py-4 text-center text-muted-foreground">正在初始化規格字典...</div>;
    }

    if (!specFields || specFields.length === 0) return null;

    /**
     * 遞迴渲染規格樹 (v5.1 以 visibleInfo 鍵值為準)
     */
    const sortedVisible = getTreeSortedVisiblePaths(specFields, visibleInfo);
    
    console.log('[DynamicSpecs] 當前 spec_values:', specValues);
    console.log('[DynamicSpecs] 排序後的可見路徑:', sortedVisible.map(s => s.pathKey));

    return (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
                分類特定規格
            </h3>
            
            <div className="space-y-4">
                {sortedVisible.map(({ pathKey, level }) => {
                    const parts = pathKey.split(':');
                    const specId = parts[1];
                    const spec = specFields.find(f => f.id === specId) || specMap.get(specId);
                    
                    if (!spec) return null;

                    const value = specValues[pathKey] || '';
                    const info = visibleInfo.get(pathKey);

                    return (
                        <div 
                            key={pathKey} 
                            style={{ marginLeft: `${level * 16}px` }}
                            className="space-y-2 animate-in fade-in slide-in-from-left-2 duration-300"
                        >
                                <div className={`p-0.5 rounded-md transition-all ${level > 0 ? 'border-l-2 border-primary/20 pl-3' : ''}`}>
                                    {spec.type === 'heading' ? (
                                        <div className="py-1 border-b border-primary/10 mb-1">
                                            <div className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                                                <span className="w-1 h-3 bg-primary rounded-full" />
                                                {spec.name}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <label className="text-xs font-semibold text-muted-foreground flex justify-between items-center group mb-1.5">
                                                <div className="flex items-center gap-2">
                                                    {level > 0 && <span className="text-primary/40">↳</span>}
                                                    <span>{spec.name}</span>
                                                </div>
                                                {info?.sourceName && (
                                                    <span className="text-[10px] font-normal opacity-0 group-hover:opacity-60 transition-opacity">
                                                        依賴於: {info.sourceName} 
                                                        {info.triggerInfo?.op === 'ne' ? ' ≠ ' : ' = '} 
                                                        {info.triggerInfo?.val}
                                                    </span>
                                                )}
                                            </label>
                                            <SpecValueEditor 
                                                spec={spec}
                                                value={value}
                                                onChange={(val) => form.setValue(`spec_values.${pathKey}`, val, { shouldDirty: true })}
                                                sourceValue={info?.sourceValue}
                                                isQuantityDetail={info?.isQuantityDetail}
                                                variantMode={false}
                                            />
                                        </>
                                    )}
                                </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
