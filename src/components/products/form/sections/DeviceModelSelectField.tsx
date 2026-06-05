import { useQuery } from '@tanstack/react-query';
import { useDeviceModels } from '@/hooks/useDeviceModels';
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
import { useDeviceModelGroups } from '@/pages/admin/products/hooks/useDeviceModelGroups';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Layers, ShieldAlert } from 'lucide-react';

interface DeviceModelSelectFieldProps {
    form: UseFormReturn<any>;
}

export function DeviceModelSelectField({ form }: DeviceModelSelectFieldProps) {
    const selectedModelIds = form.watch('device_model_ids') || [];
    const selectedGroupIds = form.watch('device_model_group_ids') || [];
    const [search, setSearch] = useState('');

    const { data: models = [] } = useDeviceModels();
    const { groups } = useDeviceModelGroups();

    const filteredModels = useMemo(() => {
        let base = models;
        if (search) {
            const searchLower = search.toLowerCase();
            base = models.filter(m => 
                m.name.toLowerCase().includes(searchLower) ||
                (m.aliases || []).some((alias: string) => alias.toLowerCase().includes(searchLower))
            );
        }
        
        // Sort: selected models to top
        return [...base].sort((a, b) => {
            const aSelected = selectedModelIds.includes(a.id) ? 1 : 0;
            const bSelected = selectedModelIds.includes(b.id) ? 1 : 0;
            if (aSelected !== bSelected) return bSelected - aSelected;
            return (a.sort_order || 0) - (b.sort_order || 0);
        });
    }, [models, search, selectedModelIds]);

    // 計算有效型號 (Direct + Groups)
    const effectiveModels = useMemo(() => {
        const directModels = models.filter(m => selectedModelIds.includes(m.id));
        
        // 這裡我們需要知道群組內部的型號。
        // 為了前端即時預覽，我們可以透過一個 query 抓取所有 group_items，
        // 或者簡單一點，如果產品已儲存則調用 RPC。
        // 這裡我們先顯示已選的群組標籤。
        return directModels;
    }, [models, selectedModelIds]);

    const selectedGroups = useMemo(() => 
        groups.filter(g => selectedGroupIds.includes(g.id)),
        [groups, selectedGroupIds]
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
                        {selectedModelIds.length === 0 && selectedGroupIds.length === 0 ? (
                            <span className="text-sm text-muted-foreground italic">
                                尚未選擇適用型號 (可選個別型號或群組)
                            </span>
                        ) : (
                            <>
                                {selectedGroups.map((group) => (
                                    <Badge
                                        key={group.id}
                                        variant="default"
                                        className="flex items-center gap-1 pr-1 bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200"
                                    >
                                        <Layers className="h-3 w-3 mr-1" />
                                        {group.name} [群組]
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-4 w-4 rounded-full hover:bg-blue-300 p-0"
                                            onClick={() => {
                                                const next = selectedGroupIds.filter((id: string) => id !== group.id);
                                                form.setValue('device_model_group_ids', next, { shouldDirty: true });
                                            }}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </Badge>
                                ))}
                                {effectiveModels.map((model: any) => (
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
                                ))}
                            </>
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
                                {selectedModelIds.length + selectedGroupIds.length > 0
                                    ? `已選擇 ${selectedModelIds.length} 個型號, ${selectedGroupIds.length} 個群組`
                                    : '新增型號或群組...'}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[350px] p-0" align="start">
                            <Tabs defaultValue="models">
                                <div className="p-2 border-b flex justify-between items-center bg-muted/20">
                                    <TabsList className="h-8">
                                        <TabsTrigger value="models" className="text-xs">個別型號</TabsTrigger>
                                        <TabsTrigger value="groups" className="text-xs">型號群組</TabsTrigger>
                                    </TabsList>
                                    <div className="relative w-32">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                        <Input 
                                            placeholder="搜尋..." 
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="h-6 pl-7 text-[10px]"
                                        />
                                    </div>
                                </div>

                                <TabsContent value="models" className="m-0">
                                    <ScrollArea className="h-[300px] w-full">
                                        <div className="p-2 space-y-1">
                                            {filteredModels.map((model) => {
                                                const isSelected = selectedModelIds.includes(model.id);
                                                const toggleModel = () => {
                                                    const next = isSelected 
                                                        ? selectedModelIds.filter((id: string) => id !== model.id)
                                                        : [...selectedModelIds, model.id];
                                                    field.onChange(next);
                                                };

                                                return (
                                                    <div
                                                        key={model.id}
                                                        className={`flex items-center gap-2 p-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 text-amber-900 border-amber-100' : ''}`}
                                                        onClick={toggleModel}
                                                    >
                                                        <Checkbox checked={isSelected} onCheckedChange={toggleModel} />
                                                        <div className="flex flex-col">
                                                            <span className="text-sm">{model.name}</span>
                                                            <span className="text-[10px] text-muted-foreground">{model.device_series}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </TabsContent>

                                <TabsContent value="groups" className="m-0">
                                    <ScrollArea className="h-[300px] w-full">
                                        <div className="p-2 space-y-1">
                                            {groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())).map((group) => {
                                                const isSelected = selectedGroupIds.includes(group.id);
                                                const toggleGroup = () => {
                                                    const next = isSelected 
                                                        ? selectedGroupIds.filter((id: string) => id !== group.id)
                                                        : [...selectedGroupIds, group.id];
                                                    form.setValue('device_model_group_ids', next, { shouldDirty: true });
                                                };

                                                return (
                                                    <div
                                                        key={group.id}
                                                        className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 text-blue-900 border-blue-100' : ''}`}
                                                        onClick={toggleGroup}
                                                    >
                                                        <Checkbox checked={isSelected} onCheckedChange={toggleGroup} />
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-2">
                                                                <Layers className="h-3 w-3 text-blue-500" />
                                                                <span className="text-sm font-medium">{group.name}</span>
                                                            </div>
                                                            <span className="text-[10px] text-muted-foreground line-clamp-1">{group.description}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </TabsContent>
                            </Tabs>
                        </PopoverContent>
                    </Popover>

                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
