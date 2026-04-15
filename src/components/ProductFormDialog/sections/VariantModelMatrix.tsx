import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceModels } from '@/hooks/useDeviceModels';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Save, Search, Loader2, CheckSquare, Square } from 'lucide-react';
import { useState, useMemo, useEffect, useRef } from 'react';

interface VariantModelMatrixProps {
    productId: string;
}

export function VariantModelMatrix({ productId }: VariantModelMatrixProps) {
    const queryClient = useQueryClient();
    const { data: models = [], isLoading: modelsLoading } = useDeviceModels();
    const [search, setSearch] = useState('');
    const [localLinks, setLocalLinks] = useState<Record<string, Set<string>>>({}); // variantId -> Set of modelIds
    const initializedProductId = useRef<string | null>(null);

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

    const { data: existingLinks = [], isLoading: linksLoading } = useQuery({
        queryKey: ['variant-model-links-batch', productId],
        queryFn: async () => {
            const variantIds = variants.map(v => v.id);
            if (variantIds.length === 0) return [];
            
            const { data, error } = await supabase
                .from('variant_model_links' as any)
                .select('variant_id, model_id')
                .in('variant_id', variantIds);
            
            if (error) throw error;
            return data as unknown as { variant_id: string, model_id: string }[];
        },
        enabled: variants.length > 0
    });

    // Sync remote data to local state
    useEffect(() => {
        // 唯有當資料載入完成，且尚未針對目前 productId 初始化時才執行
        if (!variantsLoading && !linksLoading && variants.length > 0 && initializedProductId.current !== productId) {
            const initial: Record<string, Set<string>> = {};
            variants.forEach(v => {
                initial[v.id] = new Set();
            });
            existingLinks.forEach(link => {
                if (initial[link.variant_id]) {
                    initial[link.variant_id].add(link.model_id);
                }
            });
            setLocalLinks(initial);
            initializedProductId.current = productId;
        }
    }, [existingLinks, variants, variantsLoading, linksLoading, productId]);

    const filteredModels = useMemo(() => {
        let base = models;
        if (search) {
            base = models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
        }
        
        // Sort: models with any check go to top
        return [...base].sort((a, b) => {
            const aHas = Object.values(localLinks).some(set => set.has(a.id)) ? 1 : 0;
            const bHas = Object.values(localLinks).some(set => set.has(b.id)) ? 1 : 0;
            if (aHas !== bHas) return bHas - aHas;
            return a.sort_order - b.sort_order;
        });
    }, [models, search, localLinks]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const variantIds = variants.map(v => v.id);
            if (variantIds.length === 0) return;

            // 1. Delete all existing links for these variants
            const { error: deleteError } = await supabase
                .from('variant_model_links' as any)
                .delete()
                .in('variant_id', variantIds);
            
            if (deleteError) throw deleteError;

            // 2. Prepare all new links
            const newLinks: { variant_id: string, model_id: string }[] = [];
            Object.entries(localLinks).forEach(([vId, modelIds]) => {
                modelIds.forEach(mId => {
                    newLinks.push({ variant_id: vId, model_id: mId });
                });
            });

            if (newLinks.length > 0) {
                const { error: insertError } = await supabase
                    .from('variant_model_links' as any)
                    .insert(newLinks);
                if (insertError) throw insertError;
            }
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
            if (set.has(mId)) {
                set.delete(mId);
            } else {
                set.add(mId);
            }
            next[vId] = set;
            return next;
        });
    };

    const applyRowToAll = (mId: string, checked: boolean) => {
        setLocalLinks(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(vId => {
                const set = new Set(next[vId]);
                if (checked) set.add(mId);
                else set.delete(mId);
                next[vId] = set;
            });
            return next;
        });
    };

    if (modelsLoading || variantsLoading || linksLoading) {
        return <div className="flex items-center gap-2 p-8 justify-center text-muted-foreground"><Loader2 className="animate-spin" /> 讀取型號矩陣中...</div>;
    }

    if (variants.length === 0) return null;

    return (
        <div className="space-y-4 border rounded-xl overflow-hidden bg-background">
            <div className="bg-muted/30 p-4 border-b flex flex-wrap gap-4 justify-between items-center">
                <div className="min-w-[200px]">
                    <h3 className="text-sm font-bold">變體相容型號矩陣</h3>
                    <p className="text-xs text-muted-foreground">勾選各變體具備哪些型號標籤</p>
                </div>
                
                <div className="flex flex-1 gap-2 max-w-sm">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input 
                            placeholder="搜尋型號 (如: iPhone 15)..." 
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

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/20">
                            <TableHead className="w-[200px] font-bold bg-muted/40 sticky left-0 z-10 border-r">設備型號</TableHead>
                            {variants.map(v => (
                                <TableHead key={v.id} className="min-w-[120px] text-center px-4 font-medium border-r last:border-r-0">
                                    <div className="truncate max-w-[110px]" title={v.name}>{v.name}</div>
                                </TableHead>
                            ))}
                            <TableHead className="w-[80px] text-center font-bold">全選列</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredModels.map(model => (
                            <TableRow key={model.id} className="group hover:bg-muted/5">
                                <TableCell className="font-medium bg-muted/20 sticky left-0 z-10 border-r group-hover:bg-muted/30 transition-colors">
                                    <div className="text-xs font-bold">{model.name}</div>
                                    <div className="text-[10px] text-muted-foreground opacity-60">{model.brand_id || '通用'}</div>
                                </TableCell>
                                {variants.map(v => (
                                    <TableCell key={v.id} className="p-2 border-r last:border-r-0">
                                        <div className="flex justify-center">
                                            <Checkbox 
                                                checked={!!localLinks[v.id]?.has(model.id)}
                                                onCheckedChange={() => toggleLink(v.id, model.id)}
                                            />
                                        </div>
                                    </TableCell>
                                ))}
                                <TableCell className="text-center bg-primary/5">
                                    <div className="flex justify-center gap-1">
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-7 w-7 text-primary hover:bg-primary/20"
                                            onClick={() => applyRowToAll(model.id, true)}
                                        >
                                            <CheckSquare className="h-4 w-4" />
                                        </Button>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-7 w-7 text-muted-foreground hover:bg-muted"
                                            onClick={() => applyRowToAll(model.id, false)}
                                        >
                                            <Square className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {filteredModels.length === 0 && (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        找不到符合的型號標籤
                    </div>
                )}
            </div>
        </div>
    );
}
