import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ImportRow } from './useProductImport';
import { RowStatusCell } from './cells/RowStatusCell';
import { DiffCell } from './cells/DiffCell';
import { EditableTextCell } from './cells/EditableTextCell';
import { PriceCell } from './cells/PriceCell';
import { DeviceModelCell } from './cells/DeviceModelCell';
import { BrandCategoryCell } from './cells/BrandCategoryCell';
import { ColorCell } from './cells/ColorCell';
import { SpecsCell } from './cells/SpecsCell';

interface ProductGroupSectionProps {
    groupKey: string;
    rows: ImportRow[];
    indices: number[];
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    onRemove: (index: number) => void;
    allBrands: any[];
    categories: any[];
    allDeviceModels: any[];
    allDeviceBrands: any[];
    allDeviceGroups: any[];
    allColors: any[];
    addModel: (data: any) => Promise<any>;
    specDefs?: { id: string; name: string }[];
}

export function ProductGroupSection({
    groupKey, rows, indices, onUpdate, onRemove,
    allBrands, categories, allDeviceModels, allDeviceBrands, allDeviceGroups,
    allColors, addModel, specDefs = []
}: ProductGroupSectionProps) {
    const [collapsed, setCollapsed] = useState(false);
    const mainRow = rows[0];
    const mainIdx = indices[0];
    const isNew = mainRow.action === 'create';
    const hasVariants = rows.some(r => r.is_variant);

    return (
        <div className="border rounded-lg overflow-hidden">
            <div className={cn(
                "flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors",
                !mainRow.isValid ? 'bg-destructive/5' : isNew ? 'bg-emerald-50/50' : mainRow.diff?.length ? 'bg-amber-50/50' : ''
            )}
                onClick={() => setCollapsed(!collapsed)}
            >
                <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
                    {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>

                <div className="w-[60px]"><RowStatusCell row={mainRow} /></div>
                <div className="w-[100px] shrink-0"><DiffCell row={mainRow} /></div>

                <div className="w-[120px] shrink-0">
                    <EditableTextCell
                        value={mainRow.product_sku}
                        onChange={(v) => onUpdate(mainIdx, 'product_sku', v)}
                        mono
                    />
                </div>
                <div className="flex-1 min-w-[120px]">
                    <EditableTextCell
                        value={mainRow.product_name}
                        onChange={(v) => onUpdate(mainIdx, 'product_name', v)}
                        isDiff={mainRow.diff?.includes('產品名稱')}
                    />
                </div>
                <div className="w-[80px] shrink-0">
                    <EditableTextCell
                        value={mainRow.model}
                        placeholder="型號"
                        onChange={(v) => onUpdate(mainIdx, 'model', v)}
                        isDiff={mainRow.diff?.includes('型號')}
                    />
                </div>
                <div className="w-[110px] shrink-0">
                    <BrandCategoryCell row={mainRow} index={mainIdx} onUpdate={onUpdate} allBrands={allBrands} categories={categories} type="brand" />
                </div>
                <div className="w-[110px] shrink-0 flex items-center gap-1">
                    <BrandCategoryCell row={mainRow} index={mainIdx} onUpdate={onUpdate} allBrands={allBrands} categories={categories} type="category" />

                </div>
                <div className="w-[150px] shrink-0 text-right">
                    <PriceCell row={mainRow} index={mainIdx} onUpdate={onUpdate} />
                </div>
                <div className="w-[120px] shrink-0">
                    <SpecsCell row={mainRow} specDefs={specDefs} />
                </div>
                <div className="w-[80px] shrink-0">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-50 hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); onRemove(mainIdx); }}>
                        <span className="text-[10px]">✕</span>
                    </Button>
                </div>
            </div>

            {!collapsed && hasVariants && (
                <div className="border-t bg-muted/10">
                    {rows.map((row, ri) => {
                        if (!row.is_variant) return null;
                        const idx = indices[ri];
                        return (
                            <div key={ri} className="flex items-center gap-3 px-3 py-1.5 pl-12 hover:bg-muted/20 text-xs border-b last:border-b-0">
                                <div className="w-[60px]"><RowStatusCell row={row} /></div>
                                <div className="w-[100px] shrink-0"><DiffCell row={row} /></div>
                                <div className="w-[120px] shrink-0">
                                    <EditableTextCell value={row.variant_sku} onChange={(v) => onUpdate(idx, 'variant_sku', v)} mono />
                                </div>
                                <div className="flex-1 min-w-[120px]">
                                    <EditableTextCell value={row.variant_name} onChange={(v) => onUpdate(idx, 'variant_name', v)}
                                        isDiff={row.diff?.includes('變體名稱')} />
                                </div>
                                <div className="w-[80px] shrink-0 text-[10px] text-muted-foreground">
                                    <ColorCell row={row} index={idx} onUpdate={onUpdate} allColors={allColors} />
                                </div>
                                <div className="w-[110px] shrink-0">
                                    <DeviceModelCell value={row.variant_device_models} isVariant index={idx}
                                        onUpdate={onUpdate} allDeviceModels={allDeviceModels}
                                        allDeviceBrands={allDeviceBrands} allDeviceGroups={allDeviceGroups}
                                        addModel={addModel} />
                                </div>
                                <div className="w-[150px] shrink-0 text-right">
                                    <PriceCell row={row} index={idx} onUpdate={onUpdate} />
                                </div>
                                <div className="w-[120px] shrink-0">
                                    <SpecsCell row={row} specDefs={specDefs} />
                                </div>
                                <div className="w-[80px] shrink-0">
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-50 hover:opacity-100"
                                        onClick={() => onRemove(idx)}>
                                        <span className="text-[10px]">✕</span>
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
