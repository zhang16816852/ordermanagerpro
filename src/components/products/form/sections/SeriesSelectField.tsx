import { useState, useMemo } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
    const queryClient = useQueryClient();
    const brandId = form.watch('brand_id');
    const [open, setOpen] = useState(false);
    const [localSearch, setLocalSearch] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');

    const { allSeries, refresh } = useBrandSeriesCache();

    const series = useMemo(() => {
        if (!brandId) return [];
        return allSeries.filter(s => s.brand_id === brandId);
    }, [allSeries, brandId]);

    const createSeries = useMutation({
        mutationFn: async (name: string) => {
            const { data, error } = await supabase
                .from('brand_series')
                .insert({ brand_id: brandId, name: name.trim() })
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            refresh();
            form.setValue('brand_series_id', data.id);
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

    const disabled = !brandId;

    return (
        <FormField
            control={form.control}
            name="brand_series_id"
            render={({ field }) => (
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
                                        !field.value && "text-muted-foreground"
                                    )}
                                    onClick={() => setOpen(!open)}
                                >
                                    {field.value
                                        ? series.find(s => s.id === field.value)?.name || '選擇系列'
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
                                        {createSeries.isPending ? '建立中...' : '建立並套用'}
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
                                        {field.value && (
                                            <CommandGroup heading="操作">
                                                <CommandItem
                                                    onSelect={() => { form.setValue('brand_series_id', null); setOpen(false); setLocalSearch(''); }}
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
                                            {isLoading ? (
                                                <CommandItem disabled className="text-xs text-muted-foreground">載入中...</CommandItem>
                                            ) : (
                                                series.map(s => (
                                                    <CommandItem
                                                        key={s.id}
                                                        onSelect={() => {
                                                            field.onChange(s.id);
                                                            setOpen(false);
                                                            setLocalSearch('');
                                                        }}
                                                        className="flex items-center gap-2 py-2 cursor-pointer"
                                                    >
                                                        <Check className={cn("mr-2 h-3.5 w-3.5", field.value === s.id ? "opacity-100" : "opacity-0")} />
                                                        <div className="flex flex-col flex-1 min-w-0">
                                                            <span className="text-xs font-medium truncate">{s.name}</span>
                                                            {s.description && (
                                                                <span className="text-[10px] text-muted-foreground truncate">{s.description}</span>
                                                            )}
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
                    {disabled && (
                        <p className="text-[10px] text-muted-foreground mt-1">請先選擇品牌</p>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
