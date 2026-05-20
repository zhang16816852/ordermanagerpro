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
    const { specMap, specTriggers, fetchSpecs } = useSpecStore();
    const { data: specFields = [], isLoading: specsLoading } = useCategorySpecs(categoryIds);
    const [localData, setLocalData] = useState<Record<string, Record<string, any>>>({});

    // 確保規格定義已載入
    useEffect(() => {
        fetchSpecs();
    }, []);

    const { data: variants = [], isLoading: variantsLoading } = useQuery({
        queryKey: ['product-variants-specs-v6', productId],
        queryFn: async () => {
            // 1. 抓取變體基本資料
            const { data: vData, error: vError } = await supabase
                .from('product_variants')
                .select('id, name')
                .eq('product_id', productId)
                .order('sku');
            if (vError) throw vError;

            // 2. 抓取所有變體的規格數值 (新資料表)
            const vIds = vData.map(v => v.id);
            const { data: valData, error: valError } = await supabase
                .from('entity_spec_values')
                .select('*')
                .in('entity_id', vIds)
                .eq('entity_type', 'variant')
                .is('deleted_at', null);

            if (valError) throw valError;

            // 組合資料
            return vData.map(v => {
                const variantValues = valData.filter(val => val.entity_id === v.id);
                return {
                    ...v,
                    values: variantValues,
                    spec_values: variantValues.reduce((acc: any, cur: any) => {
                        // V6 重要修正：路徑必須符合三段式 ParentId:SpecId:InstanceId
                        const pathKey = cur.parent_id
                            ? `${cur.parent_id}:${cur.spec_id}:${cur.instance_uuid || cur.spec_id}`
                            : `root:${cur.spec_id}:${cur.spec_id}`;
                        acc[pathKey] = cur.value;
                        return acc;
                    }, {})
                };
            });
        },
        enabled: !!productId
    });
    console.log("變體", variants)
    useEffect(() => {
        if (variants.length > 0) {
            console.log('[VariantMatrix] 原始變體資料與聚合後的規格:', variants);
            const initial: Record<string, any> = {};
            variants.forEach(v => {
                initial[v.id] = (v as any).spec_values || {};
            });
            console.log('[VariantMatrix] 同步至 localData:', initial);
            setLocalData(initial);
        }
    }, [variants]);

    /**
     * v5.1 樹狀動態路徑計算 (支援 DSL)
     */
    const visiblePathRows = useMemo(() => {
        if (specFields.length === 0 || Object.keys(localData).length === 0) {
            console.warn('[VariantMatrix] 跳過路徑計算: specFields 或 localData 為空', { specFieldsLen: specFields.length, localDataKeys: Object.keys(localData) });
            return [];
        }

        const aggregatedVisible = new Map<string, any>();
        Object.keys(localData).forEach(vId => {
            const variantVisible = getVisibleSpecsTree(specFields, localData[vId], specTriggers);
            variantVisible.forEach((info, path) => aggregatedVisible.set(path, info));
        });

        console.log('[VariantMatrix] 聚合後的可見路徑:', Array.from(aggregatedVisible.keys()));
        const sortedPaths = getTreeSortedVisiblePaths(specFields, aggregatedVisible);

        return sortedPaths.map(({ pathKey, level }) => {
            const parts = pathKey.split(':');
            const parentId = parts[0];
            const specId = parts[1];
            const spec = specFields.find(f => f.id === specId) || specMap.get(specId);
            const triggerInfo = aggregatedVisible.get(pathKey);

            return {
                pathKey,
                spec,
                level,
                name: spec?.name || specId,
                parentId,
                triggerInfo
            };
        });
    }, [specFields, localData, specMap, specTriggers]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const results = await Promise.all(
                Object.entries(localData).map(([id, pathObj]) => {
                    const serialized = serializeSpecs(pathObj, specMap);

                    // 呼叫新版 RPC 原子化同步
                    return supabase.rpc('sync_product_specs_v6', {
                        p_entity_id: id,
                        p_entity_type: 'variant',
                        p_category_id: categoryIds[0], // 暫取第一個分類
                        p_new_data: serialized
                    });
                })
            );
            const firstError = results.find(r => r.error);
            if (firstError) throw firstError.error;
        },
        onSuccess: () => {
            toast.success('變體規格矩陣已同步至雲端 (v6 Engine)');
            queryClient.invalidateQueries({ queryKey: ['product-variants-specs-v6', productId] });
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
        const parts = pathKey.split(':');
        const specId = parts[1];
        toast.info(`已同步「${specMap.get(specId)?.name || specId}」至所有變體`);
    };

    if (specsLoading || variantsLoading) {
        return <div className="flex items-center gap-2 p-12 justify-center text-muted-foreground"><Loader2 className="animate-spin h-5 w-5" /> 正在構建規格矩陣樹...</div>;
    }

    if (variants.length === 0) return null;

    if (visiblePathRows.length === 0) {
        return (
            <div className="space-y-4 border rounded-xl bg-background shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[300px]">
                <div className="bg-muted p-4 rounded-full mb-2">
                    <ChevronsRight className="h-8 w-8 text-muted-foreground opacity-50" />
                </div>
                <h3 className="text-base font-bold text-foreground">尚未綁定分類規格</h3>
                <p className="text-sm text-muted-foreground max-w-[400px] mt-1">
                    這個商品所屬的分類目前沒有綁定任何規格欄位。如果您需要為變體設定規格，請先至「商品分類管理」設定該分類的規格結構。
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 border rounded-xl bg-background shadow-sm">
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

            <div className="max-h-[650px] overflow-auto">
                <Table className="border-separate border-spacing-0">
                    <TableHeader>
                        <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableHead className="w-[220px] font-bold bg-slate-50 dark:bg-slate-900 sticky top-0 left-0 z-20 border-r border-b text-foreground shadow-[1px_1px_0_0_rgba(0,0,0,0.1)]">規格分層項目</TableHead>
                            {variants.map(v => (
                                <TableHead key={v.id} className="min-w-[160px] text-center px-4 font-semibold border-r border-b last:border-r-0 text-foreground/80 bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 shadow-[0_1px_0_0_rgba(0,0,0,0.1)]">
                                    <div className="whitespace-normal break-words leading-tight px-1" title={v.name}>{v.name}</div>
                                </TableHead>
                            ))}
                            <TableHead className="w-[80px] text-center font-bold text-primary bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b shadow-[0_1px_0_0_rgba(0,0,0,0.1)]">批次</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {visiblePathRows.map(row => {
                            const isHeading = row.spec?.type === 'heading';

                            return (
                                <TableRow key={row.pathKey} className={`group hover:bg-muted/5 transition-colors border-b last:border-0 ${isHeading ? 'bg-primary/5' : ''}`}>
                                    <TableCell
                                        className={`font-medium sticky left-0 z-10 border-r group-hover:bg-muted/30 transition-colors ${isHeading ? 'bg-primary/5' : 'bg-white dark:bg-[#0f172a]'}`}
                                        style={{ paddingLeft: `${row.level * 1.5 + 1}rem` }}
                                        colSpan={isHeading ? variants.length + 2 : 1}
                                    >
                                        <div className="flex items-center gap-2">
                                            {isHeading ? (
                                                <div className="flex items-center gap-2 text-primary font-bold uppercase tracking-wider text-[10px]">
                                                    <span className="w-1.5 h-4 bg-primary rounded-full" />
                                                    {row.name}
                                                </div>
                                            ) : (
                                                <>
                                                    {row.level > 0 && <ChevronsRight className="h-3 w-3 text-primary/40 shrink-0" />}
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-bold text-primary truncate">{row.name}</span>
                                                        {row.level > 0 && (
                                                            <span className="text-[9px] text-muted-foreground/60 truncate">
                                                                來自: {specMap.get(row.parentId)?.name || '父規格'}
                                                                {row.triggerInfo?.op === 'ne' ? ' ≠ ' : ' = '}
                                                                {row.triggerInfo?.val}
                                                            </span>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                    {!isHeading && (
                                        <>
                                            {variants.map(v => {
                                                const vSettings = localData[v.id] || {};
                                                const vVisiblePaths = getVisibleSpecsTree(specFields, vSettings, specTriggers);
                                                const isVis = vVisiblePaths.has(row.pathKey);
                                                const value = vSettings[row.pathKey] || '';

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
                                                                        isQuantityDetail={vVisiblePaths.get(row.pathKey)?.isQuantityDetail}
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
                                                        const firstVData = localData[variants[0].id] || {};
                                                        const firstValue = firstVData[row.pathKey] || '';
                                                        applyToAll(row.pathKey, firstValue);
                                                    }}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </>
                                    )}
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
