import { useEffect, useMemo } from 'react';
import { useColorStore } from '@/store/useColorStore';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { ImportRow } from './useProductImport';
import { PreviewToolbar } from './PreviewToolbar';
import { BatchToolbar } from './BatchToolbar';
import { ProductGroupSection } from './ProductGroupSection';

interface PreviewTableProps {
    data: ImportRow[];
    categories: any[];
    filterCategory: string;
    onFilterChange: (id: string) => void;
    filterStatus: string;
    onStatusFilterChange: (status: string) => void;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    onBatchUpdate: (updates: { index: number; field: keyof ImportRow; value: any }[]) => void;
    onRemove: (index: number) => void;
    allBrands?: any[];
    specDefs?: { id: string; name: string }[];
}

export function PreviewTable({
    data, categories, filterCategory, onFilterChange,
    filterStatus, onStatusFilterChange, onUpdate, onBatchUpdate, onRemove,
    allBrands = [], specDefs = []
}: PreviewTableProps) {
    const { colors: allColors, addColor, fetchColors, getColorByName } = useColorStore();
    const { models: allDeviceModels, brands: allDeviceBrands, groups: allDeviceGroups, addModel, fetchData: fetchDeviceData } = useDeviceModelStore();

    const safeData = data || [];

    useEffect(() => { fetchColors(); fetchDeviceData(true); }, [fetchColors, fetchDeviceData]);

    const groups = useMemo(() => {
        const map = new Map<string, { rows: ImportRow[]; indices: number[] }>();
        safeData.forEach((row, i) => {
            const key = row.product_sku;
            if (!map.has(key)) map.set(key, { rows: [], indices: [] });
            map.get(key)!.rows.push(row);
            map.get(key)!.indices.push(i);
        });
        return Array.from(map.entries()).map(([key, val]) => ({ key, ...val }));
    }, [safeData]);
 
    const handleBatchUpdate = (indices: number[], field: keyof ImportRow, value: any) => {
        onBatchUpdate(indices.map(i => ({ index: i, field, value })));
    };

    return (
        <div className="space-y-4">
            <PreviewToolbar
                data={safeData}
                filterStatus={filterStatus}
                onStatusFilterChange={onStatusFilterChange}
                filterCategory={filterCategory}
                onFilterChange={onFilterChange}
            />

            <BatchToolbar
                data={safeData}
                onBatchUpdate={handleBatchUpdate}
                allBrands={allBrands}
                categories={categories}
            />

            <div className="rounded-xl border bg-card shadow-soft overflow-hidden">
                <div className="bg-muted/60 px-3 py-1.5 flex items-center gap-3 text-[10px] font-medium text-muted-foreground border-b">
                    <span className="w-[60px] shrink-0 text-center">狀態</span>
                    <span className="w-[100px] shrink-0">變動</span>
                    <span className="w-[120px] shrink-0">SKU</span>
                    <span className="flex-1 min-w-[120px]">名稱</span>
                    <span className="w-[80px] shrink-0">型號</span>
                    <span className="w-[110px] shrink-0">品牌</span>
                    <span className="w-[110px] shrink-0">分類</span>
                    <span className="w-[150px] shrink-0 text-right">價格</span>
                    <span className="w-[120px] shrink-0">規格</span>
                    <span className="w-[80px] shrink-0 text-center">操作</span>
                </div>

                <div className="divide-y max-h-[500px] overflow-auto">
                    {groups.map(group => (
                        <ProductGroupSection
                            key={group.key}
                            groupKey={group.key}
                            rows={group.rows}
                            indices={group.indices}
                            onUpdate={onUpdate}
                            onRemove={onRemove}
                            allBrands={allBrands}
                            categories={categories}
                            allDeviceModels={allDeviceModels}
                            allDeviceBrands={allDeviceBrands}
                            allDeviceGroups={allDeviceGroups}
                            allColors={allColors}
                            addModel={addModel}
                            specDefs={specDefs}
                        />
                    ))}
                    {groups.length === 0 && (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                            無符合條件的資料
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
