import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { serializeSpecs, deserializeSpecs } from '@/utils/specLogic';
import { entityRelationService } from '@/services/entityRelationService';
import { ImportRow } from './useProductImport';

export function useProductImportUploader(
    importData: ImportRow[],
    categories: any[],
    allDeviceModels: any[],
    allDeviceGroups: any[],
    onSuccess: () => void,
    onReset: () => void
) {
    const queryClient = useQueryClient();
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processedCount, setProcessedCount] = useState(0);
    const [skippedCount, setSkippedCount] = useState(0);

    const importMutation = useMutation({
        mutationFn: async () => {
            setUploadProgress(0);
            setProcessedCount(0);
            setSkippedCount(0);

            const { SyncManager } = await import('@/services/syncManager');
            await SyncManager.performGlobalDataSync(true);

            const validRows = importData.filter(r => r.isValid);

            const isRowChanged = (row: ImportRow) => {
                if (row.action === 'create') return true;
                if (row.diff && row.diff.length > 0) return true;
                return false;
            };

            const { BatchProcessor } = await import('@/services/batchProcessor');

            const { data: specDefsData } = await supabase.from('specification_definitions').select('*');
            const specMap = new Map(specDefsData?.map(s => [s.id, s]) || []);

            const uploader = async (chunk: ImportRow[]) => {
                const chunkProductsMap = new Map<string, ImportRow>();
                chunk.forEach(row => {
                    const sku = row.product_sku;
                    const existing = chunkProductsMap.get(sku);
                    const getCatId = (cName: string | undefined) => categories.find(c => c.name === cName?.split(',')[0].trim())?.id;
                    const catId = row.category_id || getCatId((row as any)._categoryName) || getCatId(row.category);

                    if (!existing) {
                        chunkProductsMap.set(sku, { ...row, has_variants: false });
                    } else {
                        const merged = { ...existing };
                        if (!row.is_variant) Object.assign(merged, row);
                        merged.has_variants = existing.has_variants || row.is_variant;
                        chunkProductsMap.set(sku, merged);
                    }
                });

                chunk.forEach(row => {
                    if (row.is_variant || (row.variant_sku && row.variant_sku !== row.product_sku)) {
                        const p = chunkProductsMap.get(row.product_sku);
                        if (p) p.has_variants = true;
                    }
                });

                const productsUpsertData = Array.from(chunkProductsMap.values()).map(row => ({
                    id: row.product_id || crypto.randomUUID(),
                    sku: row.product_sku,
                    name: row.product_name,
                    description: row.description || null,
                    brand_id: row.brand_id || null,
                    model: row.model || null,
                    series: row.series || null,
                    base_wholesale_price: row.base_wholesale_price,
                    base_retail_price: row.base_retail_price,
                    status: row.product_status,
                    has_variants: row.has_variants,
                    barcode: row.barcode || null,
                    color: row.option_3 || null,
                }));

                if (productsUpsertData.length > 0) {
                    const { error: pErr } = await supabase.from('products').upsert(productsUpsertData, { onConflict: 'id' });
                    if (pErr) throw pErr;
                }

                const { data: insertedProducts } = await supabase.from('products').select('id, sku').in('sku', Array.from(chunkProductsMap.keys()));
                const productIdMap = new Map(insertedProducts?.map(p => [p.sku, p.id]) || []);

                const relationPromises: any[] = [];
                const variantSpecPromises: any[] = [];

                for (const [sku, row] of chunkProductsMap) {
                    const pId = productIdMap.get(sku);
                    if (!pId) continue;

                    const allCatIds = row.category_ids?.filter(Boolean) || (row.category_id ? [row.category_id] : []);
                    if (allCatIds.length > 0) {
                        relationPromises.push(
                            supabase.from('product_category_links').upsert(
                                allCatIds.map(cid => ({ product_id: pId, category_id: cid })),
                                { onConflict: 'product_id,category_id' }
                            )
                        );

                        const primaryCatId = allCatIds[0];
                        let pathMap = new Map<string, any>();
                        if (row.spec_values) {
                            const existingSpecs = deserializeSpecs(row.spec_values);
                            Object.entries(existingSpecs).forEach(([p, v]) => pathMap.set(p, v));
                        }
                        if (row._specs) {
                            Object.entries(row._specs).forEach(([key, val]) => pathMap.set(key, val));
                        }
                        const serialized = serializeSpecs(Object.fromEntries(pathMap), specMap as any);

                        if (serialized && serialized.length > 0) {
                            variantSpecPromises.push(
                                supabase.rpc('sync_product_specs_v6', {
                                    p_entity_id: pId,
                                    p_entity_type: 'product',
                                    p_category_id: primaryCatId,
                                    p_new_data: serialized
                                })
                            );
                        }
                    }
                }

                const variantSkuGroups = new Map<string, ImportRow[]>();
                chunk.filter(r => r.is_variant && r.variant_sku).forEach(r => {
                    const list = variantSkuGroups.get(r.variant_sku) || [];
                    list.push(r);
                    variantSkuGroups.set(r.variant_sku, list);
                });

                const DIFF_MAP: Record<string, string> = {
                    '變體名稱': 'name',
                    '變體選項1': 'option_1',
                    '變體選項2': 'option_2',
                    '變體選項3': 'option_3',
                    '變體批發價': 'wholesale_price',
                    '變體零售價': 'retail_price',
                    '變體狀態': 'status',
                    '變體條碼': 'barcode',
                };

                const variantsToInsert = Array.from(variantSkuGroups.entries()).map(([sku, rows]) => {
                    const rowData = rows.map(row => ({
                        product_id: productIdMap.get(row.product_sku)!,
                        sku: row.variant_sku,
                        name: row.variant_name || row.product_name,
                        option_1: row.option_1 || null,
                        option_2: row.option_2 || null,
                        option_3: row.option_3 || null,
                        wholesale_price: row.variant_wholesale_price || row.base_wholesale_price,
                        retail_price: row.variant_retail_price || row.base_retail_price,
                        status: row.variant_status || row.product_status,
                        barcode: row.barcode || null,
                        diff: (row.diff || []) as string[],
                        variant_id: row.variant_id,
                    }));

                    const matchedRow = rowData.find(r => r.variant_id);
                    const id = matchedRow?.variant_id || crypto.randomUUID();

                    const { diff, variant_id, ...rest } = rowData[0];
                    const merged = { ...rest, id };

                    for (const [diffStr, fieldKey] of Object.entries(DIFF_MAP)) {
                        const changedRows = rowData.filter(r => r.diff.includes(diffStr));
                        if (changedRows.length === 1) {
                            (merged as any)[fieldKey] = changedRows[0][fieldKey as keyof typeof changedRows[0]];
                        }
                    }

                    return merged;
                });

                if (variantsToInsert.length > 0) {
                    const { error: vErr } = await supabase.from('product_variants').upsert(variantsToInsert, { onConflict: 'id' });
                    if (vErr) throw vErr;
                }

                const parseModelString = (modelStr: string | undefined) => {
                    const result: { modelIds: string[]; groupIds: string[]; exclusions: { model_id: string }[] } = {
                        modelIds: [], groupIds: [], exclusions: []
                    };
                    if (!modelStr || modelStr.trim() === '') return result;
                    const parts = modelStr.split(',').map(s => s.trim()).filter(Boolean);
                    parts.forEach(part => {
                        let name = part;
                        let type: 'group' | 'model' | 'exclude' = 'model';
                        const lowerPart = part.toLowerCase();
                        if (lowerPart.startsWith('group:')) { type = 'group'; name = part.substring(6).trim(); }
                        else if (lowerPart.startsWith('exclude:')) { type = 'exclude'; name = part.substring(8).trim(); }
                        else if (lowerPart.startsWith('model:')) { type = 'model'; name = part.substring(6).trim(); }

                        if (type === 'group') {
                            const group = allDeviceGroups.find(g => g.name.toLowerCase() === name.toLowerCase());
                            if (group) result.groupIds.push(group.id);
                        } else if (type === 'exclude') {
                            const model = allDeviceModels.find(m =>
                                m.name.toLowerCase() === name.toLowerCase() ||
                                (m.aliases || []).some((a: string) => a.toLowerCase() === name.toLowerCase())
                            );
                            if (model) result.exclusions.push({ model_id: model.id });
                        } else {
                            const model = allDeviceModels.find(m =>
                                m.name.toLowerCase() === name.toLowerCase() ||
                                (m.aliases || []).some((a: string) => a.toLowerCase() === name.toLowerCase())
                            );
                            if (model) result.modelIds.push(model.id);
                        }
                    });
                    return result;
                };

                for (const [sku, row] of chunkProductsMap) {
                    const pId = productIdMap.get(sku);
                    if (!pId || row.device_models === undefined) continue;
                    const relations = parseModelString(row.device_models);
                    relationPromises.push(entityRelationService.updateRelations('product', pId, relations));
                }

                const { data: insertedVariants } = await supabase.from('product_variants').select('id, sku').in('sku', variantsToInsert.map(v => v.sku));
                const variantIdMap = new Map(insertedVariants?.map(v => [v.sku, v.id]) || []);

                const uniqueVariants = Array.from(new Map(chunk.filter((r: ImportRow) => r.is_variant && r.variant_sku).map((r: ImportRow) => [r.variant_sku, r])).values());
                for (const row of uniqueVariants) {
                    if (!row.variant_sku) continue;
                    const vId = variantIdMap.get(row.variant_sku);
                    if (!vId) continue;

                    if (row.variant_device_models !== undefined) {
                        const relations = parseModelString(row.variant_device_models);
                        relationPromises.push(entityRelationService.updateRelations('variant', vId, relations));
                    }

                    const catId = row.category_ids?.[0] || row.category_id;
                    if (catId && row._specs && Object.keys(row._specs).length > 0) {
                        let pathMap = new Map<string, any>();
                        if (row.spec_values) {
                            const existingSpecs = deserializeSpecs(row.spec_values);
                            Object.entries(existingSpecs).forEach(([p, v]) => pathMap.set(p, v));
                        }
                        Object.entries(row._specs).forEach(([key, val]) => pathMap.set(key, val));
                        const serialized = serializeSpecs(Object.fromEntries(pathMap), specMap as any);
                        if (serialized.length > 0) {
                            variantSpecPromises.push(
                                supabase.rpc('sync_product_specs_v6', {
                                    p_entity_id: vId,
                                    p_entity_type: 'variant',
                                    p_category_id: catId,
                                    p_new_data: serialized
                                })
                            );
                        }
                    }
                }

                for (let i = 0; i < relationPromises.length; i += 5) {
                    await Promise.all(relationPromises.slice(i, i + 5));
                }
                for (let i = 0; i < variantSpecPromises.length; i += 5) {
                    await Promise.all(variantSpecPromises.slice(i, i + 5));
                }
            };

            const batchResult = await BatchProcessor.processBatch(
                'products_import',
                validRows,
                uploader,
                {
                    batchSize: 200,
                    filterUnchanged: isRowChanged,
                    onProgress: (progress, processed) => {
                        setUploadProgress(progress);
                        setProcessedCount(processed);
                    }
                }
            );

            setSkippedCount(batchResult.skippedCount);

            if (!batchResult.success) {
                throw new Error(`批次匯入失敗！共有 ${batchResult.errors.length} 筆資料處理失敗。`);
            }

            const importedProductIds = Array.from(
                new Set(validRows.map(r => r.product_sku))
            );
            const { data: finalProducts } = await supabase.from('products')
                .select('id').in('sku', importedProductIds);
            const ids = finalProducts?.map(p => p.id) || [];

            for (let i = 0; i < ids.length; i += 5) {
                await Promise.all(
                    ids.slice(i, i + 5).map(pId =>
                        supabase.rpc('sync_storefront_items', { p_product_id: pId })
                    )
                );
            }
            await supabase.rpc('bump_data_version', { p_table_name: 'products', p_source_table: 'products' });
            return batchResult;
        },
        onSuccess: (res: any) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            toast.success(`匯入成功！已上傳變更: ${res.processedCount} 筆，跳過零異動: ${res.skippedCount} 筆。`);
            onSuccess();
            onReset();
        },
        onError: (err: any) => {
            console.error('Import error:', err);
            toast.error(`匯入失敗: ${err.message}`);
        }
    });

    return {
        importMutation,
        uploadProgress,
        processedCount,
        skippedCount,
    };
}
