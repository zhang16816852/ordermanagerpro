import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ImportRow } from '../useProductImport';

interface SeriesCellProps {
    row: ImportRow;
    index: number;
    onUpdate: (index: number, field: keyof ImportRow, value: any) => void;
    allSeries: any[];
}

export function SeriesCell({ row, index, onUpdate, allSeries }: SeriesCellProps) {
    const [localSearch, setLocalSearch] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');

    if (row.is_variant) {
        return <span className="text-[10px] text-muted-foreground/30 pl-2">-</span>;
    }

    const matchedSeries = allSeries.find(s =>
        s.brand_id === row.brand_id && s.id === row.brand_series_id
    );

    const brandFilteredSeries = allSeries.filter(s => s.brand_id === row.brand_id);

    const handleCreate = async () => {
        if (!newName.trim() || !row.brand_id) return;
        try {
            const { data, error } = await supabase
                .from('brand_series')
                .insert({ brand_id: row.brand_id, name: newName.trim() })
                .select()
                .single();
            if (error) throw error;
            onUpdate(index, 'brand_series_id', data.id);
            onUpdate(index, 'series_name', data.name);
            onUpdate(index, 'series', data.name);
            toast.success(`已建立系列：${data.name}`);
            setIsAdding(false);
            setNewName('');
            setLocalSearch('');
        } catch (err: any) {
            toast.error(err.message || '建立失敗');
        }
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <div className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50 transition-all border",
                    !row.brand_id
                        ? "border-transparent bg-muted/20 opacity-50"
                        : row.brand_series_id
                            ? "border-emerald-500/30 bg-emerald-50/50"
                            : row.series
                                ? "bg-destructive/10 border-destructive/20 text-destructive"
                                : "border-transparent bg-muted/30"
                )}>
                    {matchedSeries ? (
                        <span className="text-[10px] font-medium text-emerald-700">{matchedSeries.name}</span>
                    ) : (
                        <span className={cn(
                            "text-[10px] font-medium truncate",
                            !row.series && "text-muted-foreground italic font-normal",
                            row.series && !row.brand_series_id && "text-destructive"
                        )}>
                            {row.series || '點擊設定'}
                        </span>
                    )}
                </div>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[240px]" align="start" onWheel={(e) => e.stopPropagation()}>
                {isAdding ? (
                    <div className="p-3 space-y-3 bg-background">
                        <div className="flex items-center justify-between border-b pb-2">
                            <h4 className="text-xs font-bold text-primary">新增系列</h4>
                            <button className="h-5 w-5 flex items-center justify-center" onClick={() => { setIsAdding(false); setNewName(''); }}>
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                        <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="系列名稱"
                            className="w-full h-8 text-xs border rounded px-2"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) handleCreate(); }}
                        />
                        <button
                            className="w-full h-8 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                            onClick={handleCreate}
                            disabled={!newName.trim()}
                        >
                            建立並套用
                        </button>
                    </div>
                ) : (
                    <Command>
                        <CommandInput placeholder="搜尋或輸入..." className="h-9 text-xs"
                            value={localSearch} onValueChange={setLocalSearch} />
                        <CommandList className="max-h-[300px] overflow-y-auto">
                            <CommandGroup heading="快速操作">
                                <CommandItem onSelect={() => { setNewName(localSearch); setIsAdding(true); }}
                                    className="flex items-center gap-2 py-2 cursor-pointer text-primary">
                                    <Plus className="h-3.5 w-3.5" />
                                    <span className="text-xs">建立新系列 {localSearch ? `"${localSearch}"` : ''}</span>
                                </CommandItem>
                            </CommandGroup>
                            {row.brand_series_id && (
                                <CommandGroup heading="操作">
                                    <CommandItem onSelect={() => {
                                        onUpdate(index, 'brand_series_id', null);
                                        onUpdate(index, 'series_name', '');
                                        onUpdate(index, 'series', '');
                                        setLocalSearch('');
                                    }} className="flex items-center gap-2 py-2 cursor-pointer text-muted-foreground">
                                        <X className="h-3.5 w-3.5" />
                                        <span className="text-xs">清除已選系列</span>
                                    </CommandItem>
                                </CommandGroup>
                            )}
                            <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                找不到系列 "{localSearch}"
                            </CommandEmpty>
                            <CommandGroup heading="現有系列庫">
                                {!row.brand_id ? (
                                    <CommandItem disabled className="text-xs text-muted-foreground">請先設定品牌</CommandItem>
                                ) : (
                                    brandFilteredSeries.map(s => (
                                        <CommandItem key={s.id}
                                            onSelect={() => {
                                                onUpdate(index, 'brand_series_id', s.id);
                                                onUpdate(index, 'series_name', s.name);
                                                onUpdate(index, 'series', s.name);
                                                setLocalSearch('');
                                            }}
                                            className="flex items-center gap-2 py-2 cursor-pointer">
                                            <Check className={cn("h-3.5 w-3.5", row.brand_series_id === s.id ? "text-primary opacity-100" : "opacity-0")} />
                                            <div className="flex flex-col flex-1 min-w-0">
                                                <span className="text-xs font-medium truncate">{s.name}</span>
                                            </div>
                                        </CommandItem>
                                    ))
                                )}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                )}
            </PopoverContent>
        </Popover>
    );
}
