import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImportRow } from '../useProductImport';

interface BrandCategoryCellProps {
    row: ImportRow;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    allBrands: any[];
    categories: any[];
    type: 'brand' | 'category';
}

export function BrandCategoryCell({ row, index, onUpdate, allBrands, categories, type }: BrandCategoryCellProps) {
    if (row.is_variant) {
        return <span className="text-[9px] text-muted-foreground/20 italic pl-2">-</span>;
    }

    if (type === 'brand') {
        const brandIds = row.brand_ids || (row.brand_id ? [row.brand_id] : []);
        const hasBrand = brandIds.length > 0;
        return hasBrand ? (
            <div className="flex flex-col gap-1">
                <div className="flex flex-wrap gap-1">
                    {(row.brand_ids || (row.brand_id ? [row.brand_id] : [])).map((bid: string) => {
                        const b = allBrands.find((br: any) => br.id === bid);
                        return b ? (
                            <Badge key={bid} variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-700 bg-emerald-50/50">
                                {b.name}
                            </Badge>
                        ) : null;
                    })}
                </div>
                <span className="text-[9px] text-muted-foreground ml-1">{row.series_name || row.series || '-'}</span>
            </div>
        ) : (
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 w-full text-[10px] border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/10">
                        {row.brand || '未設定品牌'} ⚠️
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[200px]" align="start">
                    <Command>
                        <CommandInput placeholder="搜尋品牌..." />
                        <CommandList>
                            <CommandEmpty>找不到品牌</CommandEmpty>
                            <CommandGroup>
                                {allBrands.map(b => (
                                    <CommandItem key={b.id} onSelect={() => {
                                        const currentIds = row.brand_ids || (row.brand_id ? [row.brand_id] : []);
                                        const isAlreadySelected = currentIds.includes(b.id);
                                        const newIds = isAlreadySelected ? currentIds.filter((id: string) => id !== b.id) : [...currentIds, b.id];
                                        const brandNames = newIds.map((id: string) => allBrands.find((br: any) => br.id === id)?.name).filter(Boolean).join(', ');
                                        onUpdate(index, 'brand_ids', newIds);
                                        onUpdate(index, 'brand_id', newIds[0] || null);
                                        onUpdate(index, 'brand', brandNames);
                                    }} className="text-xs">
                                        <Check className={cn("mr-2 h-3 w-3", brandIds.includes(b.id) ? "opacity-100" : "opacity-0")} />
                                        {b.name}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        );
    }

    // category
    const hasCat = row.category_id;
    return hasCat ? (
        <Badge variant="outline" className="text-[10px] w-fit border-indigo-500/30 text-indigo-700 bg-indigo-50/50">
            {row.category}
        </Badge>
    ) : (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn(
                    "h-8 w-full text-[10px] justify-start px-2",
                    !row.category_id && "border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/10"
                )}>
                    {row.category || '未設定分類'} ⚠️
                </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[240px]" align="start">
                <Command>
                    <CommandInput placeholder="搜尋分類..." />
                    <CommandList>
                        <CommandEmpty>找不到分類</CommandEmpty>
                        <CommandGroup>
                            {categories.map(c => (
                                <CommandItem key={c.id} onSelect={() => { onUpdate(index, 'category', c.name); onUpdate(index, 'category_id', c.id); }} className="text-xs">
                                    <Check className={cn("mr-2 h-3 w-3", row.category_id === c.id ? "opacity-100" : "opacity-0")} />
                                    {c.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
