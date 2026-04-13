import { useQuery } from '@tanstack/react-query';
import { FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Plus, Search } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { supabase } from '@/integrations/supabase/client';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';

interface DeviceModelSelectFieldProps {
    form: UseFormReturn<any>;
}

export function DeviceModelSelectField({ form }: DeviceModelSelectFieldProps) {
    const selectedModelIds = form.watch('device_model_ids') || [];
    const [search, setSearch] = useState('');

    const { data: models = [] } = useQuery({
        queryKey: ['device_models_active'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('device_models')
                .select('*')
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true });
            if (error) return [];
            return data;
        },
    });

    const filteredModels = useMemo(() => {
        if (!search) return models;
        return models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
    }, [models, search]);

    const selectedModels = useMemo(() =>
        models.filter(m => selectedModelIds.includes(m.id)),
        [models, selectedModelIds]
    );

    return (
        <FormField
            control={form.control}
            name="device_model_ids"
            render={({ field }) => (
                <FormItem className="col-span-2">
                    <FormLabel>適用型號標籤 (可多選，選填)</FormLabel>

                    {/* 已選擇的 Badge */}
                    <div className="flex flex-wrap gap-2 mb-2 p-2 min-h-[40px] border rounded-md bg-muted/5">
                        {selectedModelIds.length === 0 ? (
                            <span className="text-sm text-muted-foreground italic">
                                尚未選擇適用型號 (若為通用商品則無須選擇)
                            </span>
                        ) : (
                            selectedModels.map((model: any) => (
                                <Badge
                                    key={model.id}
                                    variant="secondary"
                                    className="flex items-center gap-1 pr-1 bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-200"
                                >
                                    {model.name}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 rounded-full hover:bg-amber-300 p-0"
                                        onClick={() => {
                                            const next = selectedModelIds.filter((id: string) => id !== model.id);
                                            field.onChange(next);
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </Badge>
                            ))
                        )}
                    </div>

                    {/* Popover 選單 */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-start text-muted-foreground font-normal"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                {selectedModelIds.length > 0
                                    ? `已選擇 ${selectedModelIds.length} 個型號`
                                    : '新增型號標籤...'}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[300px] p-0" align="start">
                            <div className="p-2 border-b">
                                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                                    選擇型號標籤
                                </h4>
                                <div className="relative">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                    <Input 
                                        placeholder="搜尋名稱..." 
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="h-7 pl-7 text-xs"
                                    />
                                </div>
                            </div>

                            <div className="max-h-[300px] overflow-y-auto w-full custom-scrollbar">
                                <div className="p-2 space-y-1">
                                    {filteredModels.map((model) => {
                                        const isSelected = selectedModelIds.includes(model.id);
                                        const toggleModel = () => {
                                            let next: string[];
                                            if (isSelected) {
                                                next = selectedModelIds.filter((id: string) => id !== model.id);
                                            } else {
                                                next = [...selectedModelIds, model.id];
                                            }
                                            field.onChange(next);
                                        };

                                        return (
                                            <div
                                                key={model.id}
                                                className={`flex items-center gap-2 p-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-primary/5 text-primary' : ''}`}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    toggleModel();
                                                }}
                                            >
                                                <Checkbox
                                                    checked={isSelected}
                                                    className="pointer-events-none"
                                                    onCheckedChange={toggleModel}
                                                />
                                                <span className="text-sm">{model.name}</span>
                                            </div>
                                        );
                                    })}
                                    {filteredModels.length === 0 && (
                                        <p className="text-xs text-center py-4 text-muted-foreground">
                                            找不到符合的型號標籤
                                        </p>
                                    )}
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>

                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
