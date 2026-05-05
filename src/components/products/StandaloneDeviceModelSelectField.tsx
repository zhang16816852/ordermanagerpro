import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Plus, Search, Layers, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeviceModelGroups } from '@/pages/admin/products/hooks/useDeviceModelGroups';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';

interface StandaloneDeviceModelSelectFieldProps {
    modelIds?: string[];
    groupIds?: string[];
    exclusionIds?: string[];
    onChange?: (data: { modelIds: string[]; groupIds: string[]; exclusionIds: string[] }) => void;
}

export function StandaloneDeviceModelSelectField({ 
    modelIds = [], 
    groupIds = [], 
    exclusionIds = [], 
    onChange 
}: StandaloneDeviceModelSelectFieldProps) {
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

    const { groups } = useDeviceModelGroups();

    const filteredModels = useMemo(() => {
        if (!search) return models;
        const s = search.toLowerCase();
        return models.filter(m => 
            m.name.toLowerCase().includes(s) || 
            (m.device_series || '').toLowerCase().includes(s)
        );
    }, [models, search]);

    const selectedModels = useMemo(() =>
        models.filter(m => modelIds.includes(m.id)),
        [models, modelIds]
    );

    const selectedGroups = useMemo(() =>
        groups.filter(g => groupIds.includes(g.id)),
        [groups, groupIds]
    );

    const update = (newModelIds: string[], newGroupIds: string[], newExclusionIds: string[]) => {
        onChange?.({ modelIds: newModelIds, groupIds: newGroupIds, exclusionIds: newExclusionIds });
    };

    const toggleModel = (id: string) => {
        const next = modelIds.includes(id) ? modelIds.filter(i => i !== id) : [...modelIds, id];
        update(next, groupIds, exclusionIds);
    };

    const toggleGroup = (id: string) => {
        const next = groupIds.includes(id) ? groupIds.filter(i => i !== id) : [...groupIds, id];
        update(modelIds, next, exclusionIds);
    };

    return (
        <div className="space-y-2 col-span-full">
            <Label className="flex items-center gap-2">
                變體專屬型號與群組 (選填)
                <Badge variant="outline" className="text-[10px] font-normal">繼承模式</Badge>
            </Label>
            
            <div className="flex flex-wrap gap-2 mb-2 p-3 min-h-[50px] border rounded-lg bg-muted/5 shadow-inner">
                {modelIds.length === 0 && groupIds.length === 0 ? (
                    <span className="text-sm text-muted-foreground italic flex items-center gap-2">
                        <Info className="h-4 w-4 opacity-30" /> 尚未選擇專屬設定 (將完全繼承產品主設定)
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
                                {group.name}
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 rounded-full hover:bg-blue-300 p-0"
                                    onClick={() => toggleGroup(group.id)}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </Badge>
                        ))}
                        {selectedModels.map((model: any) => (
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
                                    onClick={() => toggleModel(model.id)}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </Badge>
                        ))}
                    </>
                )}
            </div>

            <Popover>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-start text-muted-foreground font-normal h-9 border-dashed"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        新增專屬型號或群組...
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0" align="start">
                    <Tabs defaultValue="models">
                        <div className="p-2 border-b flex justify-between items-center bg-muted/20">
                            <TabsList className="h-8">
                                <TabsTrigger value="models" className="text-xs">型號</TabsTrigger>
                                <TabsTrigger value="groups" className="text-xs">群組</TabsTrigger>
                            </TabsList>
                            <div className="relative w-32">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                <Input 
                                    placeholder="搜尋..." 
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="h-7 pl-7 text-xs"
                                />
                            </div>
                        </div>

                        <TabsContent value="models" className="m-0">
                            <ScrollArea className="h-[300px]">
                                <div className="p-2 space-y-1">
                                    {filteredModels.map((model) => {
                                        const isSelected = modelIds.includes(model.id);
                                        return (
                                            <div
                                                key={model.id}
                                                className={`flex items-center gap-2 p-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 text-amber-900' : ''}`}
                                                onClick={() => toggleModel(model.id)}
                                            >
                                                <Checkbox checked={isSelected} onCheckedChange={() => toggleModel(model.id)} />
                                                <span className="text-sm">
                                                    {model.device_series ? <span className="text-[10px] text-muted-foreground mr-1">[{model.device_series}]</span> : null}
                                                    {model.name}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </TabsContent>

                        <TabsContent value="groups" className="m-0">
                            <ScrollArea className="h-[300px]">
                                <div className="p-2 space-y-1">
                                    {groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())).map((group) => {
                                        const isSelected = groupIds.includes(group.id);
                                        return (
                                            <div
                                                key={group.id}
                                                className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 text-blue-900' : ''}`}
                                                onClick={() => toggleGroup(group.id)}
                                            >
                                                <Checkbox checked={isSelected} onCheckedChange={() => toggleGroup(group.id)} />
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1">
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
        </div>
    );
}

const Info = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
);
