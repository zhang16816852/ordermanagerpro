import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
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

            const { data: specDefsData } = await (supabase.from('specification_definitions') as any).select('*');
            const specMap = new Map(specDefsData?.map(s => [s.id, s]) || []);

            const uploader = async (chunk: ImportRow[]) => {
                const chunkProductsMap = new Map<string, ImportRow>();
                chunk.forEach(row => {
                    const code = row.product_code;
                    const existing = chunkProductsMap.get(code);
                    const getCatId = (cName: string | undefined) => categories.find(c => c.name === cName?.split(',')[0].trim())?.id;
                    const catId = row.category_id || getCatId((row as any)._categoryName) || getCatId(row.category);

                    if (!existing) {
                        chunkProductsMap.set(code, { ...row });
                    } else {
                        const merged = { ...existing };
                        if (!row.is_variant) {
                            const mergedFields = new Set<string>([
                                ...(existing._presentFields || []),
                                ...(row._presentFields || [])
                            ]);
                            Object.assign(merged, row);
                            merged._presentFields = mergedFields;
                        }
                        chunkProductsMap.set(code, merged);
                    }
                });

                const productsUpsertData = Array.from(chunkProductsMap.values()).map(row => {
                    const present = row._presentFields;
                    const has = (key: string) => !present || present.has(key);

                    const data: Record<string, any> = {
                        id: row.product_id || crypto.randomUUID(),
                        code: row.product_code,
                        name: row.product_name,
                    };

                    if (has('description')) data.description = row.description || null;

                    return data;
                });

                if (productsUpsertData.length > 0) {
                    const { error: pErr } = await (supabase.from('products') as any).upsert(productsUpsertData, { onConflict: 'id' });
                    if (pErr) throw pErr;
                }

                const { data: insertedProducts } = await (supabase.from('products') as any).select('id, code').in('code', Array.from(chunkProductsMap.keys()));
                const productIdMap = new Map(insertedProducts?.map(p => [p.code, p.id]) || []);

                const seriesLinkData: { product_id: string; brand_series_id: string }[] = [];
                const brandLinkData: { product_id: string; brand_id: string; is_primary: boolean }[] = [];
                for (const [code, row] of chunkProductsMap) {
                    const pId = productIdMap.get(code);
                    if (pId && row.brand_series_id) {
                        seriesLinkData.push({ product_id: String(pId), brand_series_id: String(row.brand_series_id) });
                    }
                    const brandIds = row.brand_ids || (row.brand_id ? [row.brand_id] : []);
                    brandIds.forEach((bid: any, i: number) => {
                        if (pId) brandLinkData.push({ product_id: String(pId), brand_id: String(bid), is_primary: i === 0 });
                    });
                }
                if (seriesLinkData.length > 0) {
                    await (supabase.from('product_series_links') as any).upsert(seriesLinkData, { onConflict: 'product_id,brand_series_id' });
                }
                if (brandLinkData.length > 0) {
                    await (supabase.from('product_brands') as any).upsert(brandLinkData, { onConflict: 'product_id,brand_id' });
                }

                const relationPromises: any[] = [];
                const variantSpecPromises: any[] = [];

                for (const [code, row] of chunkProductsMap) {
                    const pId = productIdMap.get(code);
                    if (!pId) continue;

                    const allCatIds = row.category_ids?.filter(Boolean) || (row.category_id ? [row.category_id] : []);
                    if (allCatIds.length > 0) {
                        relationPromises.push(
                            (supabase.from('product_category_links') as any).upsert(
                                allCatIds.map(cid => ({ product_id: pId, category_id: cid })),
                                { onConflict: 'product_id,category_id' }
                            )
                        );

                        const primaryCatId = allCatIds[0] as string;
                        const pathMap = new Map<string, any>();
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
                                    p_entity_id: String(pId),
                                    p_entity_type: 'product',
                                    p_category_id: String(primaryCatId),
                                    p_new_data: serialized as any
                                })
                            );
                        }
                    }
                }

                const variantSkuGroups = new Map<string, ImportRow[]>();
                chunk.filter(r => r.is_variant && r.variant_sku).forEach(r => {
                    const sku = r.variant_sku!;
                    const list = variantSkuGroups.get(sku) || [];
                    list.push(r);
                    variantSkuGroups.set(sku, list);
                });

                const DIFF_MAP: Record<string, string> = {
                    '變體名稱': 'name',
                    '變體批發價': 'wholesale_price',
                    '變體零售價': 'retail_price',
                    '變體狀態': 'status',
                    '變體條碼': 'barcode',
                };

                const variantsToInsert = Array.from(variantSkuGroups.entries()).map(([sku, rows]) => {
                    // 合併所有 rows 的 _presentFields
                    const mergedPresent = new Set<string>();
                    rows.forEach(r => r._presentFields?.forEach(f => mergedPresent.add(f)));
                    const has = (key: string) => mergedPresent.size === 0 || mergedPresent.has(key);

                    const rowData = rows.map(row => {
                        const data: Record<string, any> = {
                            product_id: productIdMap.get(row.product_code)!,
                            sku: row.variant_sku,
                            name: row.variant_name || row.product_name,
                            diff: (row.diff || []) as string[],
                            variant_id: row.variant_id,
                        };
                        if (has('wholesale_price') || has('variant_wholesale_price')) data.wholesale_price = row.variant_wholesale_price;
                        if (has('retail_price') || has('variant_retail_price')) data.retail_price = row.variant_retail_price;
                        if (has('status')) data.status = row.variant_status || 'active';
                        if (has('barcode')) data.barcode = row.barcode || null;
                        return data;
                    });

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
                    const { error: vErr } = await (supabase.from('product_variants') as any).upsert(variantsToInsert, { onConflict: 'id' });
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
                    const relations = parseModelString(String(row.device_models));
                    relationPromises.push(entityRelationService.updateRelations('product', String(pId), relations));
                }

                const { data: insertedVariants } = await (supabase.from('product_variants') as any).select('id, sku').in('sku', variantsToInsert.map(v => (v as any).sku));
                const variantIdMap = new Map(insertedVariants?.map(v => [v.sku, v.id]) || []);

                const uniqueVariants = Array.from(new Map(chunk.filter((r: ImportRow) => r.is_variant && r.variant_sku).map((r: ImportRow) => [r.variant_sku, r])).values());
                for (const row of uniqueVariants) {
                    if (!row.variant_sku) continue;
                    const vId = variantIdMap.get(row.variant_sku);
                    if (!vId) continue;

                    if (row.variant_device_models !== undefined) {
                        const relations = parseModelString(String(row.variant_device_models));
                        relationPromises.push(entityRelationService.updateRelations('variant', String(vId), relations));
                    }

                    const catId = row.category_ids?.[0] || row.category_id;
                    if (catId && row._specs && Object.keys(row._specs).length > 0) {
                        const pathMap = new Map<string, any>();
                        if (row.spec_values) {
                            const existingSpecs = deserializeSpecs(row.spec_values);
                            Object.entries(existingSpecs).forEach(([p, v]) => pathMap.set(p, v));
                        }
                        Object.entries(row._specs).forEach(([key, val]) => pathMap.set(key, val));
                        const serialized = serializeSpecs(Object.fromEntries(pathMap), specMap as any);
                        if (serialized.length > 0) {
                            variantSpecPromises.push(
                                supabase.rpc('sync_product_specs_v6', {
                                    p_entity_id: String(vId),
                                    p_entity_type: 'variant',
                                    p_category_id: String(catId),
                                    p_new_data: serialized as any
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
                new Set(validRows.map(r => r.product_code))
            );
            const { data: finalProducts } = await (supabase.from('products') as any)
                .select('id').in('code', importedProductIds);
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
            toast.error(`匯入失敗: ${getErrorMessage(err)}`);
        }
    });

    return {
        importMutation,
        uploadProgress,
        processedCount,
        skippedCount,
    };
}
