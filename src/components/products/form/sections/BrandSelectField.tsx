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
import { useBrands } from '@/hooks/useBrands';

interface BrandSelectFieldProps {
    form: UseFormReturn<any>;
}

export function BrandSelectField({ form }: BrandSelectFieldProps) {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [localSearch, setLocalSearch] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAbbr, setNewAbbr] = useState('');

    const { brands, refresh } = useBrands();
    const selectedIds: string[] = form.watch('brand_ids') || [];

    const createBrand = useMutation({
        mutationFn: async ({ name, abbreviation }: { name: string; abbreviation?: string }) => {
            const { data, error } = await supabase
                .from('brands')
                .insert({ name: name.trim(), abbreviation: abbreviation?.trim() || null })
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            refresh();
            form.setValue('brand_ids', [...selectedIds, data.id]);
            toast.success(`已建立品牌：${data.name}`);
            setIsAdding(false);
            setNewName('');
            setNewAbbr('');
            setLocalSearch('');
            setOpen(false);
        },
        onError: (err: any) => {
            toast.error(err.message || '建立失敗');
        },
    });

    const toggleBrand = (brandId: string) => {
        const current = selectedIds;
        const next = current.includes(brandId)
            ? current.filter(id => id !== brandId)
            : [...current, brandId];

        form.setValue('brand_ids', next);

        // Auto-fill product name and SKU based on primary brand (first selected)
        if (next.length === 1) {
            const brand = brands.find((b: any) => b.id === next[0]);
            if (brand) {
                const currentName = form.getValues('name') || '';
                const currentSku = form.getValues('sku') || '';
                form.setValue('name', currentName ? `${brand.name} ${currentName}` : brand.name);
                form.setValue('sku', brand.abbreviation ? `${brand.abbreviation}${currentSku}` : currentSku);
            }
        }
    };

    const removeBrand = (brandId: string) => {
        const next = selectedIds.filter(id => id !== brandId);
        form.setValue('brand_ids', next);
    };

    const selectedBrands = useMemo(() =>
        brands.filter((b: any) => selectedIds.includes(b.id)),
        [brands, selectedIds]
    );

    return (
        <FormField
            control={form.control}
            name="brand_ids"
            render={() => (
                <FormItem>
                    <FormLabel>品牌（可多選）</FormLabel>
                    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setIsAdding(false); setNewName(''); setNewAbbr(''); } }}>
                        <PopoverTrigger asChild>
                            <FormControl>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                        "w-full justify-between h-10 text-sm font-normal",
                                        selectedIds.length === 0 && "text-muted-foreground"
                                    )}
                                    onClick={() => setOpen(!open)}
                                >
                                    {selectedIds.length > 0
                                        ? selectedBrands.map(b => b.name).join(', ')
                                        : '選擇品牌'}
                                    <Plus className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 w-[300px]" align="start">
                            {isAdding ? (
                                <div className="p-3 space-y-3 bg-background">
                                    <div className="flex items-center justify-between border-b pb-2">
                                        <h4 className="text-xs font-bold text-primary">新增品牌</h4>
                                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setIsAdding(false); setNewName(''); setNewAbbr(''); }}>
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <Input
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        placeholder="品牌名稱"
                                        className="h-8 text-xs"
                                        autoFocus
                                        onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createBrand.mutate({ name: newName, abbreviation: newAbbr }); }}
                                    />
                                    <Input
                                        value={newAbbr}
                                        onChange={(e) => setNewAbbr(e.target.value)}
                                        placeholder="縮寫（選填）"
                                        className="h-8 text-xs"
                                        onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) createBrand.mutate({ name: newName, abbreviation: newAbbr }); }}
                                    />
                                    <Button
                                        className="w-full h-8 text-xs"
                                        onClick={() => newName.trim() && createBrand.mutate({ name: newName, abbreviation: newAbbr })}
                                        disabled={!newName.trim() || createBrand.isPending}
                                    >
                                        {createBrand.isPending ? '建立中...' : '建立並加入'}
                                    </Button>
                                </div>
                            ) : (
                                <Command>
                                    <CommandInput
                                        placeholder="搜尋品牌..."
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
                                                <span className="text-xs">建立新品牌 {localSearch ? `"${localSearch}"` : ''}</span>
                                            </CommandItem>
                                        </CommandGroup>
                                        <CommandGroup heading="現有品牌">
                                            {brands.map((brand: any) => {
                                                const isSelected = selectedIds.includes(brand.id);
                                                return (
                                                    <CommandItem
                                                        key={brand.id}
                                                        onSelect={() => toggleBrand(brand.id)}
                                                        className="flex items-center gap-2 py-2 cursor-pointer"
                                                    >
                                                        <div className={cn(
                                                            "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                            isSelected ? "bg-primary text-primary-foreground" : "opacity-50"
                                                        )}>
                                                            {isSelected && <Check className="h-3 w-3" />}
                                                        </div>
                                                        <div className="flex flex-col flex-1 min-w-0">
                                                            <span className="text-xs font-medium truncate">
                                                                {brand.name}
                                                                {brand.abbreviation ? ` (${brand.abbreviation})` : ''}
                                                            </span>
                                                        </div>
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            )}
                        </PopoverContent>
                    </Popover>
                    {selectedBrands.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {selectedBrands.map((b: any) => (
                                <span key={b.id} className="inline-flex items-center gap-1 text-[10px] bg-secondary px-2 py-0.5 rounded-full">
                                    {b.name}
                                    <X className="h-2.5 w-2.5 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => removeBrand(b.id)} />
                                </span>
                            ))}
                        </div>
                    )}
                    {brands.length === 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1">尚未建立任何品牌，請至分類管理新增</p>
                    )}
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
