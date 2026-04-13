import { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import Papa from 'papaparse';
import jschardet from 'jschardet';
import { toast } from 'sonner';

export interface ImportRow {
    product_sku: string;
    product_name: string;
    description: string;
    category: string;
    category_id?: string;
    brand: string;
    model: string;
    series: string;
    base_wholesale_price: number;
    base_retail_price: number;
    product_status: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    table_settings?: string;
    variant_sku?: string;
    variant_name?: string;
    option_1?: string;
    option_2?: string;
    option_3?: string;
    variant_wholesale_price?: number;
    variant_retail_price?: number;
    variant_status?: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    variant_table_settings?: string;
    barcode?: string;
    device_models?: string;
    variant_device_models?: string;
    hasVariant: boolean;
    errors: string[];
    isValid: boolean;
}

const PRODUCT_REQUIRED = ['product_sku', 'product_name'];
const PRODUCT_OPTIONAL = ['description', 'category', 'category_id', 'brand', 'model', 'series', 'base_wholesale_price', 'base_retail_price', 'product_status', 'table_settings', 'device_models'];
const VARIANT_FIELDS = ['variant_sku', 'variant_name', 'option_1', 'option_2', 'option_3', 'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'variant_table_settings', 'barcode', 'variant_device_models'];

export function useProductImport(onSuccess: () => void) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await supabase.from('categories').select('*');
            if (error) return [];
            return data;
        },
    });

    const { data: allDeviceModels = [] } = useQuery({
        queryKey: ['device_models_for_import'],
        queryFn: async () => {
            const { data, error } = await supabase.from('device_models').select('*');
            if (error) return [];
            return data;
        },
    });

    const resetState = () => {
        setStep('upload');
        setImportData([]);
    };

    const normalizeBarcode = (value: any): string => {
        if (!value) return '';
        if (typeof value === 'number') return value.toLocaleString('fullwide', { useGrouping: false });
        const str = String(value);
        if (/e\+/i.test(str)) return Number(str).toLocaleString('fullwide', { useGrouping: false });
        return str.trim();
    };

    const validateRow = (row: Omit<ImportRow, 'errors' | 'isValid' | 'hasVariant'>): { errors: string[]; hasVariant: boolean } => {
        const errors: string[] = [];
        if (!row.product_sku) errors.push('產品 SKU 為必填');
        if (!row.product_name) errors.push('產品名稱為必填');
        const hasVariant = !!(row.variant_sku || row.variant_name);
        if (hasVariant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填（當有變體資料時）');
            if (!row.variant_name) errors.push('變體名稱為必填（當有變體資料時）');
        }
        return { errors, hasVariant };
    };

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result;
            if (!(result instanceof ArrayBuffer)) return;

            const uint8Array = new Uint8Array(result);
            const binaryString = Array.from(uint8Array.slice(0, 1000)).map(b => String.fromCharCode(b)).join('');
            const detection = jschardet.detect(binaryString);
            const encoding = detection.encoding || 'UTF-8';

            Papa.parse(file, {
                encoding,
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    const rows = results.data as string[][];
                    if (rows.length < 2) {
                        toast.error('CSV 檔案至少需要標題列和一筆資料');
                        return;
                    }

                    const headerRow = rows[0].map(h => h.toLowerCase().trim());
                    const autoMapping: Record<string, number> = {};
                    const allFields = [...PRODUCT_REQUIRED, ...PRODUCT_OPTIONAL, ...VARIANT_FIELDS];

                    headerRow.forEach((header, index) => {
                        const matchedField = allFields.find(f =>
                            header === f || header.replace(/_/g, ' ') === f.replace(/_/g, ' ') || header.includes(f)
                        );
                        if (matchedField) autoMapping[matchedField] = index;
                    });

                    const parsedData: ImportRow[] = rows.slice(1).map(row => {
                        const getField = (field: string): string => {
                            const index = autoMapping[field] ?? -1;
                            return index >= 0 && index < row.length ? row[index].trim() : '';
                        };

                        const baseRow: Omit<ImportRow, 'errors' | 'isValid' | 'hasVariant'> = {
                            product_sku: getField('product_sku'),
                            product_name: getField('product_name'),
                            brand: getField('brand'),
                            model: getField('model'),
                            series: getField('series'),
                            description: getField('description'),
                            category: getField('category'),
                            category_id: getField('category_id'),
                            base_wholesale_price: parseFloat(getField('base_wholesale_price')) || 0,
                            base_retail_price: parseFloat(getField('base_retail_price')) || 0,
                            product_status: (['active', 'discontinued', 'preorder', 'sold_out'].includes(getField('product_status').toLowerCase())
                                ? getField('product_status').toLowerCase()
                                : 'active') as any,
                            table_settings: getField('table_settings'),
                            variant_sku: getField('variant_sku'),
                            variant_name: getField('variant_name'),
                            option_1: getField('option_1'),
                            option_2: getField('option_2'),
                            option_3: getField('option_3'),
                            variant_wholesale_price: parseFloat(getField('variant_wholesale_price')) || undefined,
                            variant_retail_price: parseFloat(getField('variant_retail_price')) || undefined,
                            variant_status: (['active', 'discontinued', 'preorder', 'sold_out'].includes(getField('variant_status').toLowerCase())
                                ? getField('variant_status').toLowerCase()
                                : undefined) as any,
                            variant_table_settings: getField('variant_table_settings'),
                            barcode: getField('barcode'),
                            device_models: getField('device_models'),
                            variant_device_models: getField('variant_device_models'),
                        };

                        const { errors, hasVariant } = validateRow(baseRow);
                        return { ...baseRow, hasVariant, errors, isValid: errors.length === 0 };
                    });

                    // Duplicate detection
                    const productSkuCount = new Map<string, number>();
                    const variantSkuCount = new Map<string, number>();
                    parsedData.forEach(row => {
                        if (row.product_sku && !row.hasVariant) productSkuCount.set(row.product_sku, (productSkuCount.get(row.product_sku) || 0) + 1);
                        if (row.variant_sku) variantSkuCount.set(row.variant_sku, (variantSkuCount.get(row.variant_sku) || 0) + 1);
                    });

                    parsedData.forEach(row => {
                        if (!row.hasVariant) {
                            const count = productSkuCount.get(row.product_sku) || 0;
                            if (count > 1) { row.errors.push(`產品 SKU "${row.product_sku}" 重複出現 ${count} 次`); row.isValid = false; }
                        }
                        if (row.variant_sku) {
                            const count = variantSkuCount.get(row.variant_sku) || 0;
                            if (count > 1) { row.errors.push(`變體 SKU "${row.variant_sku}" 重複出現 ${count} 次`); row.isValid = false; }
                        }
                    });

                    setImportData(parsedData);
                    setStep('preview');
                },
                error: (error) => toast.error(`解析失敗：${error.message}`)
            });
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const updateRow = (index: number, field: keyof ImportRow, value: any) => {
        setImportData(prev => {
            const updated = [...prev];
            const row = { ...updated[index], [field]: value };
            const { errors, hasVariant } = validateRow(row);
            updated[index] = { ...row, errors, hasVariant, isValid: errors.length === 0 };
            return updated;
        });
    };

    const removeRow = (index: number) => setImportData(prev => prev.filter((_, i) => i !== index));

    const importMutation = useMutation({
        mutationFn: async () => {
            const validRows = importData.filter(r => r.isValid);
            const uniqueProductsMap = new Map<string, ImportRow>();
            validRows.forEach(row => { if (!uniqueProductsMap.has(row.product_sku)) uniqueProductsMap.set(row.product_sku, row); });

            const productsToInsert = Array.from(uniqueProductsMap.values()).map(row => ({
                sku: row.product_sku,
                name: row.product_name,
                description: row.description || null,
                model: row.model || null,
                series: row.series || null,
                brand: row.brand || null,
                base_wholesale_price: row.base_wholesale_price,
                base_retail_price: row.base_retail_price,
                status: row.product_status,
                has_variants: row.hasVariant,
                table_settings: row.table_settings ? JSON.parse(row.table_settings) : {},
            }));

            const { error: productError } = await supabase.from('products').upsert(productsToInsert, { onConflict: 'sku' });
            if (productError) throw productError;

            const { data: products, error: fetchError } = await supabase.from('products').select('id, sku').in('sku', Array.from(uniqueProductsMap.keys()));
            if (fetchError) throw fetchError;
            const productIdMap = new Map(products?.map(p => [p.sku, p.id]) || []);

            // Category Links
            const catLinks = Array.from(uniqueProductsMap.values()).map(row => {
                let catId = row.category_id || categories.find(c => c.name === row.category)?.id;
                return catId ? { product_id: productIdMap.get(row.product_sku), category_id: catId } : null;
            }).filter(Boolean);

            if (catLinks.length > 0) {
                await (supabase.from('product_category_links' as any) as any).delete().in('product_id', Array.from(productIdMap.values()));
                await (supabase.from('product_category_links' as any) as any).insert(catLinks);
            }

            // Product Device Models (Tags)
            const productModelLinksToInsert = Array.from(uniqueProductsMap.values()).flatMap(row => {
                if (!row.device_models) return [];
                const names = row.device_models.split(',').map(n => n.trim()).filter(Boolean);
                const pId = productIdMap.get(row.product_sku);
                if (!pId) return [];
                return names.map(name => {
                    const mId = allDeviceModels.find(dm => dm.name.toLowerCase() === name.toLowerCase())?.id;
                    return mId ? { product_id: pId, model_id: mId } : null;
                }).filter(Boolean);
            });

            if (productModelLinksToInsert.length > 0) {
                await supabase.from('product_model_links').delete().in('product_id', Array.from(productIdMap.values()));
                await supabase.from('product_model_links').insert(productModelLinksToInsert as any);
            }

            // Variants
            const variantsToInsert = validRows.filter(r => r.hasVariant).map(row => ({
                product_id: productIdMap.get(row.product_sku)!,
                sku: row.variant_sku!,
                name: row.variant_name!,
                option_1: row.option_1 || null,
                option_2: row.option_2 || null,
                option_3: row.option_3 || null,
                wholesale_price: row.variant_wholesale_price || row.base_wholesale_price,
                retail_price: row.variant_retail_price || row.base_retail_price,
                barcode: normalizeBarcode(row.barcode) || null,
                status: row.variant_status || row.product_status,
                table_settings: row.variant_table_settings ? JSON.parse(row.variant_table_settings) : {},
            }));

            if (variantsToInsert.length > 0) {
                const { data: upsertedVariants, error } = await supabase.from('product_variants').upsert(variantsToInsert, { onConflict: 'sku' }).select('id, sku');
                if (error) throw error;
                
                // Variant Model Links
                if (upsertedVariants) {
                    const variantIdMap = new Map(upsertedVariants.map(v => [v.sku, v.id]));
                    
                    const variantModelLinksToInsert = validRows.filter(r => r.hasVariant).flatMap(row => {
                        if (!row.variant_device_models) return [];
                        const names = row.variant_device_models.split(',').map(n => n.trim()).filter(Boolean);
                        const vId = variantIdMap.get(row.variant_sku!);
                        if (!vId) return [];
                        return names.map(name => {
                            const mId = allDeviceModels.find(dm => dm.name.toLowerCase() === name.toLowerCase())?.id;
                            return mId ? { variant_id: vId, model_id: mId } : null;
                        }).filter(Boolean);
                    });

                    if (variantModelLinksToInsert.length > 0) {
                        await supabase.from('variant_model_links').delete().in('variant_id', Array.from(variantIdMap.values()));
                        await supabase.from('variant_model_links').insert(variantModelLinksToInsert as any);
                    }
                }
            }
        },
        onSuccess: () => {
            toast.success('匯入成功');
            queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
            queryClient.invalidateQueries({ queryKey: ['all-active-variants'] });
            onSuccess();
        },
        onError: (error: Error) => toast.error(`匯入失敗：${error.message}`),
    });

    const downloadTemplate = () => {
        const csvContent = [
            'product_sku,product_name,description,category,category_id,brand,model,series,device_models,base_wholesale_price,base_retail_price,product_status,table_settings,variant_sku,variant_name,option_1,option_2,option_3,variant_device_models,variant_wholesale_price,variant_retail_price,variant_status,variant_table_settings,barcode',
            'PROD-001,基本款T恤,純棉舒適T恤,服飾,,品牌A,T系列,,iPhone 15 Pro,100,150,active,{},,,,,,,,,,',
            'SHIRT-001,彩色襯衫,渲染襯衫,服飾,,品牌A,系列2,,,100,150,active,{},SHIRT-001-RED-S,紅色 S,紅色,S,,iPhone 14,,,,{}',
        ].join('\n');
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '產品匯入範本.csv';
        link.click();
    };

    return {
        step, setStep, importData, isLoading: importMutation.isPending,
        handleFileUpload, updateRow, removeRow, importMutation, downloadTemplate, resetState
    };
}
