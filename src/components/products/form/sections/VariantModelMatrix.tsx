import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import { useDeviceModelGroups } from '@/pages/admin/products/hooks/useDeviceModelGroups';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Save, Search, Loader2, CheckSquare, Square, Layers } from 'lucide-react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VariantModelMatrixModelsTab } from './VariantModelMatrixModelsTab';
import { VariantModelMatrixGroupsTab } from './VariantModelMatrixGroupsTab';

interface VariantModelMatrixProps {
    productId: string;
}

export function VariantModelMatrix({ productId }: VariantModelMatrixProps) {
    const queryClient = useQueryClient();
    const { data: models = [], isLoading: modelsLoading } = useDeviceModels();
    const { groups, isLoading: groupsLoading } = useDeviceModelGroups();
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'models' | 'groups'>('models');
    const [localLinks, setLocalLinks] = useState<Record<string, Set<string>>>({}); // variantId -> Set of modelIds
    const [localGroupLinks, setLocalGroupLinks] = useState<Record<string, Set<string>>>({}); // variantId -> Set of groupIds
    const initializedProductId = useRef<string | null>(null);

    // --- 變體清單 ---
    const { data: variants = [], isLoading: variantsLoading } = useQuery({
        queryKey: ['product-variants-models', productId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_variants')
                .select('id, name')
                .eq('product_id', productId)
                .order('sku');
            if (error) throw error;
            return data;
        },
        enabled: !!productId
    });

    // --- 現有關聯 (從合併後的 entity_model_relations 讀取) ---
    const { data: existingLinks = [], isLoading: linksLoading } = useQuery({
        queryKey: ['variant-model-links-batch', productId],
        queryFn: async () => {
            const variantIds = variants.map(v => v.id);
            if (variantIds.length === 0) return [];
            const { data, error } = await supabase
                .from('entity_model_relations')
                .select('variant_id, model_id, group_id, relation_type')
                .in('variant_id', variantIds);
            if (error) throw error;
            return data as { variant_id: string; model_id: string | null; group_id: string | null; relation_type: string }[];
        },
        enabled: variants.length > 0
    });

    // --- 同步遠端資料到本地 state ---
    useEffect(() => {
        if (
            !variantsLoading && !linksLoading &&
            variants.length > 0 &&
            initializedProductId.current !== productId
        ) {
            const initialModels: Record<string, Set<string>> = {};
            const initialGroups: Record<string, Set<string>> = {};
            variants.forEach(v => {
                initialModels[v.id] = new Set();
                initialGroups[v.id] = new Set();
            });
            existingLinks.forEach(link => {
                if (link.relation_type === 'include' && link.model_id && initialModels[link.variant_id]) {
                    initialModels[link.variant_id].add(link.model_id);
                }
                if (link.relation_type === 'include' && link.group_id && initialGroups[link.variant_id]) {
                    initialGroups[link.variant_id].add(link.group_id);
                }
            });
            setLocalLinks(initialModels);
            setLocalGroupLinks(initialGroups);
            initializedProductId.current = productId;
        }
    }, [existingLinks, variants, variantsLoading, linksLoading, productId]);

    // --- 篩選型號 ---
    const filteredModels = useMemo(() => {
        let base = models;
        if (search) base = models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
        return [...base].sort((a, b) => {
            const aHas = Object.values(localLinks).some(set => set.has(a.id)) ? 1 : 0;
            const bHas = Object.values(localLinks).some(set => set.has(b.id)) ? 1 : 0;
            if (aHas !== bHas) return bHas - aHas;
            return a.sort_order - b.sort_order;
        });
    }, [models, search, localLinks]);

    // --- 篩選群組 ---
    const filteredGroups = useMemo(() => {
        let base = groups;
        if (search) base = groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
        return [...base].sort((a, b) => {
            const aHas = Object.values(localGroupLinks).some(set => set.has(a.id)) ? 1 : 0;
            const bHas = Object.values(localGroupLinks).some(set => set.has(b.id)) ? 1 : 0;
            return bHas - aHas;
        });
    }, [groups, search, localGroupLinks]);

    // --- 儲存 Mutation (使用 entity_model_relations) ---
    const saveMutation = useMutation({
        mutationFn: async () => {
            const variantIds = variants.map(v => v.id);
            if (variantIds.length === 0) return;

            // 1. 刪除此產品所有變體的現有關聯
            const { error: deleteErr } = await supabase
                .from('entity_model_relations')
                .delete()
                .in('variant_id', variantIds)
                .eq('relation_type', 'include');
            if (deleteErr) throw deleteErr;

            // 2. 插入新的關聯 (個別型號 + 群組一次寫入)
            const newLinks: any[] = [];
            Object.entries(localLinks).forEach(([vId, modelIds]) => {
                modelIds.forEach(mId => {
                    newLinks.push({ variant_id: vId, model_id: mId, relation_type: 'include' });
                });
            });
            Object.entries(localGroupLinks).forEach(([vId, groupIds]) => {
                groupIds.forEach(gId => {
                    newLinks.push({ variant_id: vId, group_id: gId, relation_type: 'include' });
                });
            });
            if (newLinks.length > 0) {
                const { error } = await supabase.from('entity_model_relations').insert(newLinks);
                if (error) throw error;
            }

            // 3. 同步前台展示虛擬商品
            const { error: syncError } = await supabase.rpc('sync_storefront_items', { p_product_id: productId });
            if (syncError) throw syncError;
        },
        onSuccess: () => {
            toast.success('變體型號關連已儲存');
            queryClient.invalidateQueries({ queryKey: ['variant-model-links-batch', productId] });
        },
        onError: (err: any) => {
            toast.error('儲存失敗：' + err.message);
        }
    });

    const toggleLink = (vId: string, mId: string) => {
        setLocalLinks(prev => {
            const next = { ...prev };
            const set = new Set(next[vId]);
            if (set.has(mId)) set.delete(mId); else set.add(mId);
            next[vId] = set;
            return next;
        });
    };

    const toggleGroupLink = (vId: string, gId: string) => {
        setLocalGroupLinks(prev => {
            const next = { ...prev };
            const set = new Set(next[vId]);
            if (set.has(gId)) set.delete(gId); else set.add(gId);
            next[vId] = set;
            return next;
        });
    };

    const applyRowToAll = (mId: string, checked: boolean) => {
        setLocalLinks(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(vId => {
                const set = new Set(next[vId]);
                if (checked) set.add(mId); else set.delete(mId);
                next[vId] = set;
            });
            return next;
        });
    };

    const applyGroupRowToAll = (gId: string, checked: boolean) => {
        setLocalGroupLinks(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(vId => {
                const set = new Set(next[vId]);
                if (checked) set.add(gId); else set.delete(gId);
                next[vId] = set;
            });
            return next;
        });
    };

    const isLoading = modelsLoading || groupsLoading || variantsLoading || linksLoading;

    if (isLoading) {
        return <div className="flex items-center gap-2 p-8 justify-center text-muted-foreground"><Loader2 className="animate-spin" /> 讀取型號矩陣中...</div>;
    }

    if (variants.length === 0) return null;

    return (
        <div className="space-y-6">
            <div className="border rounded-xl overflow-hidden bg-background">
                {/* === 工具列 === */}
                <div className="bg-muted/30 p-4 border-b flex flex-wrap gap-4 justify-between items-center">
                    <div className="min-w-[200px]">
                        <h3 className="text-sm font-bold">變體相容型號矩陣</h3>
                        <p className="text-xs text-muted-foreground">勾選各變體具備哪些型號或型號群組</p>
                    </div>

                    <div className="flex flex-1 gap-2 max-w-sm">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder={activeTab === 'models' ? "搜尋型號..." : "搜尋群組..."}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="h-9 pl-9 text-sm"
                            />
                        </div>
                    </div>

                    <Button
                        size="sm"
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending}
                    >
                        {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        儲存型號變動
                    </Button>
                </div>

                {/* === 分頁內容 === */}
                <div className="p-4">
                    <Tabs value={activeTab} onValueChange={(val) => {
                        setActiveTab(val as 'models' | 'groups');
                        setSearch('');
                    }}>
                        <TabsList className="mb-4">
                            <TabsTrigger value="models">
                                個別型號 <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1">{filteredModels.length}</Badge>
                            </TabsTrigger>
                            <TabsTrigger value="groups">
                                型號群組 <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1">{filteredGroups.length}</Badge>
                            </TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="models" className="mt-0 outline-none">
                            <VariantModelMatrixModelsTab 
                                variants={variants}
                                filteredModels={filteredModels}
                                localLinks={localLinks}
                                toggleLink={toggleLink}
                                applyRowToAll={applyRowToAll}
                            />
                        </TabsContent>
                        
                        <TabsContent value="groups" className="mt-0 outline-none">
                            <VariantModelMatrixGroupsTab 
                                variants={variants}
                                filteredGroups={filteredGroups}
                                localGroupLinks={localGroupLinks}
                                toggleGroupLink={toggleGroupLink}
                                applyGroupRowToAll={applyGroupRowToAll}
                            />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}
