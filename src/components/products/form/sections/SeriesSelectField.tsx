import { useState, useMemo } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useBrandSeriesCache } from '@/hooks/useBrandSeriesCache';

interface SeriesSelectFieldProps {
    form: UseFormReturn<any>;
}

export function SeriesSelectField({ form }: SeriesSelectFieldProps) {
    const brandIds: string[] = form.watch('brand_ids') || [];
    const [open, setOpen] = useState(false);
    const [localSearch, setLocalSearch] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');

    const { allSeries, refresh } = useBrandSeriesCache();
    const selectedIds: string[] = form.watch('brand_series_ids') || [];

    const series = useMemo(() => {
        if (brandIds.length === 0) return [];
        return allSeries.filter(s => s.is_active !== false && brandIds.includes(s.brand_id));
    }, [allSeries, brandIds]);

    const createSeries = useMutation({
        mutationFn: async (name: string) => {
            const targetBrandId = brandIds[0];
            const { data, error } = await supabase
                .from('brand_series')
                .insert({ brand_id: targetBrandId, name: name.trim() })
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            refresh();
            form.setValue('brand_series_ids', [...selectedIds, data.id]);
            toast.success(`已建立系列：${data.name}`);
            setIsAdding(false);
            setNewName('');
            setLocalSearch('');
            setOpen(false);
        },
        onError: (err: any) => {
            toast.error(err.message || '建立失敗');
        },
    });

    const toggleSeries = (seriesId: string) => {
        const next = selectedIds.includes(seriesId)
            ? selectedIds.filter(id => id !== seriesId)
            : [...selectedIds, seriesId];
        form.setValue('brand_series_ids', next);
    };

    const selectedSeries = useMemo(() =>
        series.filter(s => selectedIds.includes(s.id)),
        [series, selectedIds]
    );

    const disabled = brandIds.length === 0;

    return (
        <FormField
            control={form.control}
            name="brand_series_ids"
            render={() => (
                <FormItem>
                    <FormLabel>系列 (選填)</FormLabel>
                    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setIsAdding(false); setNewName(''); } }}>
                        <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    disabled={disabled}
                                    className={cn(
                                        "w-full justify-between h-10 text-sm font-normal",
                                        selectedIds.length === 0 && "text-muted-foreground"
                                    )}
                                    onClick={() => setOpen(!open)}
                                >
                                    {selectedIds.length > 0
                                        ? selectedSeries.map(s => s.name).join(', ')
                                        : disabled ? '請先選擇品牌' : '選擇系列'}
                                    <Plus className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-[260px]" align="start">
                            {isAdding ? (
                                <div className="p-3 space-y-3 bg-background">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <h4 className="text-xs font-bold text-primary">新增系列</h4>
                                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setIsAdding(false); setNewName(''); }}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <Input
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder="系列名稱"
                                        className="h-8 text-xs"
                                        autoFocus
                                        onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createSeries.mutate(newName); }}
                                    />
                                    <Button
                                        className="w-full h-8 text-xs"
                                        onClick={() => newName.trim() && createSeries.mutate(newName)}
                                        disabled={!newName.trim() || createSeries.isPending}
                                    >
                                        {createSeries.isPending ? '建立中...' : '建立並加入'}
                                    </Button>
                                </div>
                            ) : (
                                <Command>
                                    <CommandInput
                                        placeholder="搜尋系列..."
                                        className="h-9 text-xs"
                                        value={localSearch}
                                        onValueChange={setLocalSearch}
                                    />
                                    <CommandList className="max-h-[300px] overflow-y-auto">
                                        <CommandGroup heading="快速操作">
                                            <CommandItem
                                                onSelect={() => { setNewName(localSearch); setIsAdding(true); }}
                                                className="flex items-center gap-2 py-2 cursor-pointer text-primary"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                                <span className="text-xs">建立新系列 {localSearch ? `"${localSearch}"` : ''}</span>
                                            </CommandItem>
                                        </CommandGroup>
                                        {selectedIds.length > 0 && (
                                            <CommandGroup heading="操作">
                                                <CommandItem
                                                    onSelect={() => { form.setValue('brand_series_ids', []); setOpen(false); setLocalSearch(''); }}
                                                    className="flex items-center gap-2 py-2 cursor-pointer text-muted-foreground"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                    <span className="text-xs">清除已選系列</span>
                                                </CommandItem>
                                            </CommandGroup>
                                        )}
                                        <CommandEmpty className="py-3 text-xs text-center text-muted-foreground">
                                            找不到系列 "{localSearch}"
                                        </CommandEmpty>
                                        <CommandGroup heading="現有系列庫">
                                            {series.length === 0 && brandIds.length > 0 ? (
                                                <CommandItem disabled className="text-xs text-muted-foreground">此品牌尚無系列</CommandItem>
                                            ) : (
                                                series.map(s => {
                                                    const isSelected = selectedIds.includes(s.id);
                                                    return (
                                                        <CommandItem
                                                            key={s.id}
                                                            onSelect={() => toggleSeries(s.id)}
                                                            className="flex items-center gap-2 py-2 cursor-pointer"
                                                        >
                                                            <div className={cn(
                                                                "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                                isSelected ? "bg-primary text-primary-foreground" : "opacity-50"
                                                            )}>
                                                                {isSelected && <Check className="h-3 w-3" />}
                                                            </div>
                                                            <div className="flex flex-col flex-1 min-w-0">
                                                                <span className="text-xs font-medium truncate">{s.name}</span>
                                                                {s.description && (
                                                                    <span className="text-[10px] text-muted-foreground truncate">{s.description}</span>
                                                                )}
                                                            </div>
                                                        </CommandItem>
                                                    );
                                                })
                                            )}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            )}
                        </PopoverContent>
                    </Popover>
                    {selectedSeries.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {selectedSeries.map(s => (
                                <span key={s.id} className="inline-flex items-center gap-1 text-[10px] bg-secondary px-2 py-0.5 rounded-full">
                                    {s.name}
                                    <X className="h-2.5 w-2.5 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => toggleSeries(s.id)} />
                                </span>
                            ))}
                        </div>
                    )}
                    {disabled && (
                        <p className="text-[10px] text-muted-foreground mt-1">請先選擇品牌</p>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
