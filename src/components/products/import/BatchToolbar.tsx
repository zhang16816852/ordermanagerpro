import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { ImportRow } from './useProductImport';

interface BatchToolbarProps {
    data: ImportRow[];
    onBatchUpdate: (indices: number[], field: keyof ImportRow, value: any) => void;
    allBrands: any[];
    categories: any[];
}

export function BatchToolbar({ data, onBatchUpdate, allBrands, categories }: BatchToolbarProps) {
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    const [selectAll, setSelectAll] = useState(false);

    const toggleSelectAll = () => {
        if (selectAll) {
            setSelectedIndices(new Set());
        } else {
            setSelectedIndices(new Set(data.map((_, i) => i)));
        }
        setSelectAll(!selectAll);
    };

    const toggleRow = (index: number) => {
        const next = new Set(selectedIndices);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setSelectedIndices(next);
    };

    const batchApply = (field: keyof ImportRow, value: any) => {
        if (selectedIndices.size === 0) return;
        onBatchUpdate(Array.from(selectedIndices), field, value);
    };

    if (data.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2 bg-muted/10 p-2 rounded-lg border border-dashed">
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={toggleSelectAll}>
                {selectAll ? '取消全選' : `全選 (${data.length})`}
            </Button>
            <span className="text-[10px] text-muted-foreground">已選 {selectedIndices.size} 筆</span>

            <div className="h-4 w-px bg-border mx-1" />

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]">
                        批次設品牌 <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-2">
                    <Select onValueChange={(v) => {
                        const brand = allBrands.find(b => b.id === v);
                        if (brand) {
                            selectedIndices.forEach(i => {
                                onBatchUpdate([i], 'brand', brand.name);
                                onBatchUpdate([i], 'brand_id', brand.id);
                            });
                        }
                    }}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="選擇品牌" />
                        </SelectTrigger>
                        <SelectContent>
                            {allBrands.map(b => (
                                <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </PopoverContent>
            </Popover>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]">
                        批次設分類 <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-2">
                    <Select onValueChange={(v) => {
                        const cat = categories.find(c => c.id === v);
                        if (cat) {
                            selectedIndices.forEach(i => {
                                onBatchUpdate([i], 'category', cat.name);
                                onBatchUpdate([i], 'category_id', cat.id);
                            });
                        }
                    }}>
                        <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="選擇分類" />
                        </SelectTrigger>
                        <SelectContent>
                            {categories.map(c => (
                                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </PopoverContent>
            </Popover>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-[10px]">
                        批次調價 <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[220px] p-3 space-y-2">
                    <div className="space-y-1">
                        <Label className="text-[10px]">增加 %</Label>
                        <Input type="number" placeholder="例如 10" className="h-7 text-xs"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    const pct = parseFloat((e.target as HTMLInputElement).value);
                                    if (!isNaN(pct)) {
                                        selectedIndices.forEach(i => {
                                            const row = data[i];
                                            const wholesale = row.is_variant
                                                ? (row.variant_wholesale_price ?? row.base_wholesale_price)
                                                : row.base_wholesale_price;
                                            const retail = row.is_variant
                                                ? (row.variant_retail_price ?? row.base_retail_price)
                                                : row.base_retail_price;
                                            const wKey = row.is_variant ? 'variant_wholesale_price' : 'base_wholesale_price';
                                            const rKey = row.is_variant ? 'variant_retail_price' : 'base_retail_price';
                                            onBatchUpdate([i], wKey as any, Math.round(wholesale * (1 + pct / 100) * 100) / 100);
                                            onBatchUpdate([i], rKey as any, Math.round(retail * (1 + pct / 100) * 100) / 100);
                                        });
                                    }
                                }
                            }}
                        />
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
