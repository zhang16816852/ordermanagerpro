import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCategorySpecs } from '@/hooks/useCategorySpecs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Save, Copy, Loader2, ChevronsRight } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { SpecValueEditor } from './SpecValueEditor';
import { deserializeSpecs, serializeSpecs, getVisibleSpecsTree, getTreeSortedVisiblePaths } from '@/utils/specLogic';
import { useSpecStore } from '@/store/useSpecStore';

interface VariantSpecsMatrixProps {
    productId: string;
    categoryIds: string[];
}

export function VariantSpecsMatrix({ productId, categoryIds }: VariantSpecsMatrixProps) {
    const queryClient = useQueryClient();
    const { specMap } = useSpecStore();
    const { data: specFields = [], isLoading: specsLoading } = useCategorySpecs(categoryIds);
    console.log("變體資料", specFields)
    const [localData, setLocalData] = useState<Record<string, Record<string, any>>>({});

    const { data: variants = [], isLoading: variantsLoading } = useQuery({
        queryKey: ['product-variants-specs', productId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('product_variants')
                .select('id, name, table_settings')
                .eq('product_id', productId)
                .order('sku');
            if (error) throw error;
            return data;
        },
        enabled: !!productId
    });

    useEffect(() => {
        if (variants.length > 0) {
            const initial: Record<string, any> = {};
            variants.forEach(v => {
                initial[v.id] = deserializeSpecs(v.table_settings);
            });
            setLocalData(initial);
        }
    }, [variants]);

    /**
     * v4.7 樹狀動態路徑計算
     */
    const visiblePathRows = useMemo(() => {
        if (specFields.length === 0 || Object.keys(localData).length === 0) return [];

        // 1. 收集「所有變體」目前可見的總合路徑地圖
        const aggregatedVisible = new Map<string, any>();
        Object.keys(localData).forEach(vId => {
            const variantVisible = getVisibleSpecsTree(specFields, localData[vId]);
            variantVisible.forEach((info, path) => aggregatedVisible.set(path, info));
        });

        // 2. 利用樹狀演算法進行 DFS 排序，確保父子連隨
        const sortedPaths = getTreeSortedVisiblePaths(specFields, aggregatedVisible);

        return sortedPaths.map(({ pathKey, level }) => {
            const [_, specId] = pathKey.split(':');
            const spec = specFields.find(f => f.id === specId) || specMap.get(specId);
            const triggerInfo = aggregatedVisible.get(pathKey);
            return {
                pathKey,
                spec,
                level,
                name: spec?.name || specId,
                parentId: pathKey.split(':')[0],
                triggerInfo // 將觸發資訊帶出 useMemo
            };
        });
    }, [specFields, localData, specMap]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const results = await Promise.all(
                Object.entries(localData).map(([id, pathObj]) => {
                    const originalVariant = variants.find(v => v.id === id);
                    const serialized = serializeSpecs(
                        pathObj, 
                        specMap, 
                        originalVariant?.table_settings as any
                    );
                    return supabase.from('product_variants').update({ table_settings: serialized as any }).eq('id', id);
                })
            );
            const firstError = results.find(r => r.error);
            if (firstError) throw firstError.error;
        },
        onSuccess: () => {
            toast.success('變體規格矩陣已同步至雲端');
            queryClient.invalidateQueries({ queryKey: ['product-variants-specs', productId] });
        },
        onError: (err: any) => toast.error('儲存失敗：' + err.message)
    });

    const handleValueChange = (variantId: string, pathKey: string, value: any) => {
        setLocalData(prev => ({
            ...prev,
            [variantId]: { ...prev[variantId], [pathKey]: value }
        }));
    };

    const applyToAll = (pathKey: string, value: any) => {
        setLocalData(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(vId => {
                next[vId] = { ...next[vId], [pathKey]: value };
            });
            return next;
        });
        const [_, specId] = pathKey.split(':');
        toast.info(`已同步「${specMap.get(specId)?.name || specId}」至所有變體`);
    };

    if (specsLoading || variantsLoading) {
        return <div className="flex items-center gap-2 p-12 justify-center text-muted-foreground"><Loader2 className="animate-spin h-5 w-5" /> 正在構建規格矩陣樹...</div>;
    }

    if (visiblePathRows.length === 0 || variants.length === 0) return null;

    return (
        <div className="space-y-4 border rounded-xl overflow-hidden bg-background shadow-sm">
            <div className="bg-muted/30 p-4 border-b flex justify-between items-center">
                <div>
                    <h3 className="text-sm font-bold tracking-tight">變體規格矩陣 (v4.7 Registry)</h3>
                    <p className="text-xs text-muted-foreground">DFS 樹狀排序與動態可見性聯動</p>
                </div>
                <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="shadow-sm">
                    {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    儲存矩陣變動
                </Button>
            </div>

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableHead className="w-[220px] font-bold bg-muted/40 sticky left-0 z-10 border-r text-foreground">規格分層項目</TableHead>
                            {variants.map(v => (
                                <TableHead key={v.id} className="min-w-[160px] text-center px-4 font-semibold border-r last:border-r-0 text-foreground/80">
                                    <div className="truncate max-w-[150px] mx-auto" title={v.name}>{v.name}</div>
                                </TableHead>
                            ))}
                            <TableHead className="w-[80px] text-center font-bold text-primary">批次</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visiblePathRows.map(row => (
                            <TableRow key={row.pathKey} className="group hover:bg-muted/5 transition-colors border-b last:border-0">
                                <TableCell
                                    className="font-medium bg-muted/20 sticky left-0 z-10 border-r group-hover:bg-muted/30 transition-colors"
                                    style={{ paddingLeft: `${row.level * 1.5 + 1}rem` }}
                                >
                                    <div className="flex items-center gap-2">
                                        {row.level > 0 && <ChevronsRight className="h-3 w-3 text-primary/40 shrink-0" />}
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-xs font-bold text-primary truncate">{row.name}</span>
                                            {row.level > 0 && (
                                                <span className="text-[9px] text-muted-foreground/60 truncate">
                                                    來自: {specMap.get(row.parentId)?.name || '父規格'} 
                                                    {row.triggerInfo?.operator === 'ne' ? ' ≠ ' : ' = '}
                                                    {row.triggerInfo?.triggerValue}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </TableCell>
                                {variants.map(v => {
                                    const vSettings = localData[v.id] || {};
                                    const vVisiblePaths = getVisibleSpecsTree(specFields, vSettings);
                                    const isVis = vVisiblePaths.has(row.pathKey);

                                    const [_, specId] = row.pathKey.split(':');
                                    const value = vSettings[row.pathKey] !== undefined && vSettings[row.pathKey] !== ''
                                        ? vSettings[row.pathKey]
                                        : (vSettings[`root:${specId}`] || '');

                                    return (
                                        <TableCell key={v.id} className={`p-2 border-r last:border-r-0 transition-all ${!isVis ? 'bg-muted/5' : ''}`}>
                                            <div className="flex justify-center w-full">
                                                {isVis && row.spec ? (
                                                    <div className="w-full max-w-[140px] opacity-100 scale-100 transition-all duration-200">
                                                        <SpecValueEditor
                                                            spec={row.spec}
                                                            value={value}
                                                            onChange={(val) => handleValueChange(v.id, row.pathKey, val)}
                                                            sourceValue={vVisiblePaths.get(row.pathKey)?.sourceValue}
                                                            variantMode={true}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="h-9 flex items-center justify-center opacity-20 italic text-[10px]">
                                                        未觸發
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>
                                    );
                                })}
                                <TableCell className="text-center bg-primary/5 group-hover:bg-primary/10 transition-colors">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                                        onClick={() => {
                                            const [_, specId] = row.pathKey.split(':');
                                            const firstVData = localData[variants[0].id] || {};
                                            const firstValue = firstVData[row.pathKey] !== undefined && firstVData[row.pathKey] !== ''
                                                ? firstVData[row.pathKey]
                                                : (firstVData[`root:${specId}`] || '');
                                            applyToAll(row.pathKey, firstValue);
                                        }}
                                    >
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
