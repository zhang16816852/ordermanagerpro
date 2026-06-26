import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X, Plus, Search, Layers, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/utils';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDeviceModelGroups } from '@/pages/admin/products/hooks/useDeviceModelGroups';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

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
    const [showAddModel, setShowAddModel] = useState(false);
    const [newModelName, setNewModelName] = useState('');
    const [showAddGroup, setShowAddGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const queryClient = useQueryClient();

    const addModelMutation = useMutation({
        mutationFn: async (name: string) => {
            const { data, error } = await supabase
                .from('device_models')
                .insert([{ name, is_active: true }])
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['device_models_active'] });
            toggleModel(data.id);
            setNewModelName('');
            setShowAddModel(false);
            toast.success(`已新增型號「${data.name}」`);
        },
        onError: (err) => toast.error('新增型號失敗: ' + err.message),
    });

    const addGroupMutation = useMutation({
        mutationFn: async (name: string) => {
            const { data, error } = await supabase
                .from('device_model_groups')
                .insert([{ name }])
                .select()
                .single();
            if (error) throw error;
            return data;
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['device_model_groups'] });
            toggleGroup(data.id);
            setNewGroupName('');
            setShowAddGroup(false);
            toast.success(`已新增群組「${data.name}」`);
        },
        onError: (err) => toast.error('新增群組失敗: ' + err.message),
    });

    const { data: models = [] } = useQuery({
        queryKey: ['device_models_active'],
        queryFn: async () => {
            return fetchAllRows<any>(
                'device_models', '*',
                { eq: [['is_active', true]], order: [{ column: 'sort_order' }, { column: 'name' }] }
            );
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
        <div className="space-y-2">
            
            <div className="flex flex-wrap gap-2 mb-2 p-3 min-h-[50px] border rounded-lg bg-muted/5 shadow-inner">
                {modelIds.length === 0 && groupIds.length === 0 ? (
                    <span className="text-sm text-muted-foreground italic flex items-center gap-2">
                        <Info className="h-4 w-4 opacity-30" /> 尚未選擇型號或群組
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
                        選擇型號或群組...
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0 overflow-hidden max-h-[min(400px,var(--radix-popover-content-available-height))]" align="start" usePortal={false}>
                    <Tabs defaultValue="models" className="flex flex-col h-full min-h-0">
                        <div className="flex-shrink-0 p-2 border-b flex justify-between items-center bg-muted/20">
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

                        <div className="flex-1 min-h-0 overflow-hidden">
                            <TabsContent value="models" className="m-0 flex flex-col h-full min-h-0">
                                <ScrollArea className="h-[260px] w-full">
                                    <div className="p-2 space-y-1">
                                    {filteredModels.map((model) => {
                                        const isSelected = modelIds.includes(model.id);
                                        return (
                                            <div
                                                key={model.id}
                                                className={`flex items-center gap-2 p-1.5 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 text-amber-900' : ''}`}
                                                onClick={() => toggleModel(model.id)}
                                            >
                                                <span onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox checked={isSelected} onCheckedChange={() => toggleModel(model.id)} />
                                                </span>
                                                <span className="text-sm">
                                                    {model.device_series ? <span className="text-[10px] text-muted-foreground mr-1">[{model.device_series}]</span> : null}
                                                    {model.name}
                                                </span>
                                            </div>
                                        );
                                    })}
                                    </div>
                                </ScrollArea>
                                <div className="border-t p-2">
                                    {showAddModel ? (
                                        <div className="flex gap-1">
                                            <Input
                                                placeholder="輸入型號名稱..."
                                                value={newModelName}
                                                onChange={(e) => setNewModelName(e.target.value)}
                                                className="h-7 text-xs flex-1"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        if (newModelName.trim()) addModelMutation.mutate(newModelName.trim());
                                                    }
                                                }}
                                            />
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => newModelName.trim() && addModelMutation.mutate(newModelName.trim())}
                                                disabled={!newModelName.trim() || addModelMutation.isPending}
                                            >
                                                新增
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAddModel(true)}>
                                            <Plus className="h-3 w-3 mr-1" />快速新增型號
                                        </Button>
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="groups" className="m-0 flex flex-col h-full min-h-0">
                                <ScrollArea className="h-[260px] w-full">
                                    <div className="p-2 space-y-1">
                                    {groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase())).map((group) => {
                                        const isSelected = groupIds.includes(group.id);
                                        return (
                                            <div
                                                key={group.id}
                                                className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 text-blue-900' : ''}`}
                                                onClick={() => toggleGroup(group.id)}
                                            >
                                                <span onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox checked={isSelected} onCheckedChange={() => toggleGroup(group.id)} />
                                                </span>
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
                                <div className="border-t p-2">
                                    {showAddGroup ? (
                                        <div className="flex gap-1">
                                            <Input
                                                placeholder="輸入群組名稱..."
                                                value={newGroupName}
                                                onChange={(e) => setNewGroupName(e.target.value)}
                                                className="h-7 text-xs flex-1"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        if (newGroupName.trim()) addGroupMutation.mutate(newGroupName.trim());
                                                    }
                                                }}
                                            />
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => newGroupName.trim() && addGroupMutation.mutate(newGroupName.trim())}
                                                disabled={!newGroupName.trim() || addGroupMutation.isPending}
                                            >
                                                新增
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setShowAddGroup(true)}>
                                            <Plus className="h-3 w-3 mr-1" />快速新增群組
                                        </Button>
                                    )}
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                </PopoverContent>
            </Popover>
        </div>
    );
}

const Info = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
);
