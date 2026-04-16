import { UseFormReturn } from 'react-hook-form';
import { SpecValueEditor } from './SpecValueEditor';
import { getVisibleSpecsTree } from '@/utils/specLogic';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { useSpecStore } from '@/store/useSpecStore';

interface DynamicSpecsFieldsProps {
    form: UseFormReturn<any>;
}

export function DynamicSpecsFields({ form }: DynamicSpecsFieldsProps) {
    const selectedCategoryIds = form.watch('category_ids') || [];
    const { specMap } = useSpecStore();
    const { data: specFields = [], isLoading: isLoadingSpecs } = useCategorySpecs(selectedCategoryIds);
    const tableSettings = form.watch('table_settings') || {};

    // 使用中央計算器 (v4.3 支持純物件)
    const visibleInfo = getVisibleSpecsTree(specFields, tableSettings);

    if (isLoadingSpecs) return <div className="py-4 text-center">正在載入規格...</div>;
    
    // 如果規格定義 Map 還沒載入好，先顯示提示
    if (specMap.size === 0 && specFields.length > 0) {
        return <div className="py-4 text-center text-muted-foreground">正在初始化規格字典...</div>;
    }

    if (!specFields || specFields.length === 0) return null;

    /**
     * 遞迴渲染規格樹 (v4.11 修復：使用完整 Path Key 進行階層比對)
     */
    const renderSpecTree = (parentPath: string = 'root', level = 0) => {
        // v4.11 強制型別斷言為 string[]
        const keys = Array.from(visibleInfo.keys()) as string[];
        
        // v4.11 修正：過濾出父路徑為 parentPath 且「多一層級」的子項
        const parentPartsCount = parentPath.split(':').length;
        const visibleKeys = keys.filter(k => 
            k.startsWith(`${parentPath}:`) && 
            k.split(':').length === parentPartsCount + 1
        );

        if (visibleKeys.length === 0) return null;

        return (
            <div className={`space-y-4 ${level > 0 ? 'ml-6 pl-4 border-l-2 border-primary/10' : ''}`}>
                {visibleKeys.map(pathKey => {
                    const pKey = pathKey as string;
                    const specId = pKey.split(':').pop()!;
                    const spec = specFields.find(f => f.id === specId) || specMap.get(specId);
                    
                    if (!spec) return null;

                    const value = (tableSettings[pKey] !== undefined && tableSettings[pKey] !== '')
                        ? tableSettings[pKey] 
                        : (tableSettings[`root:${specId}`] || '');

                    return (
                        <div key={pKey} className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="space-y-1.5 min-h-[60px]">
                                <label className="text-xs font-semibold text-muted-foreground flex justify-between">
                                    {spec.name}
                                </label>
                                <SpecValueEditor 
                                    spec={spec}
                                    value={value}
                                    onChange={(val) => form.setValue(`table_settings.${pKey}`, val, { shouldDirty: true })}
                                    sourceValue={visibleInfo.get(pKey)?.sourceValue}
                                    variantMode={false}
                                />
                            </div>
                            {renderSpecTree(pKey, level + 1)}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/10">
            <h3 className="text-sm font-bold flex items-center gap-2">
                分類特定規格
            </h3>
            {renderSpecTree('root')}
        </div>
    );
}
