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
    // New fields for comparison
    action?: 'create' | 'update';
    diff?: string[];
}

const PRODUCT_REQUIRED = ['product_sku', 'product_name'];
const PRODUCT_OPTIONAL = ['description', 'category', 'category_id', 'brand', 'model', 'series', 'base_wholesale_price', 'base_retail_price', 'product_status', 'table_settings', 'device_models'];
const VARIANT_FIELDS = ['variant_sku', 'variant_name', 'option_1', 'option_2', 'option_3', 'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'variant_table_settings', 'barcode', 'variant_device_models'];

export function useProductImport(onSuccess: () => void) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);
    const [filterCategory, setFilterCategory] = useState<string>('all');

    const { data: categories = [] } = useQuery({
        queryKey: ['categories'],
        queryFn: async () => {
            const { data, error } = await supabase.from('categories').select('*');
            if (error) return [];
            return data;
        },
    });

    const { data: specDefs = [] } = useQuery({
        queryKey: ['specification_definitions_all'],
        queryFn: async () => {
            const { data, error } = await supabase.from('specification_definitions').select('*');
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

    const parseCondensedSpecs = (specStr: string) => {
        if (!specStr || specStr.trim() === '') return {};
        const settings: Record<string, any> = {};
        const pairs = specStr.split(',').map(p => p.trim()).filter(Boolean);
        
        pairs.forEach(pair => {
            const [name, ...valParts] = pair.split(':');
            const value = valParts.join(':').trim();
            const specId = specDefs.find(sd => sd.name === name.trim())?.id || name.trim();
            
            // Handle lists/arrays if value contains /
            if (value.includes('/')) {
                settings[specId] = value.split('/').map(v => v.trim());
            } else {
                settings[specId] = value;
            }
        });
        return settings;
    };

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
                        let matchedField = allFields.find(f =>
                            header === f || header.replace(/_/g, ' ') === f.replace(/_/g, ' ') || header.includes(f)
                        );

                        // Special mapping for Chinese headers from exported CSVs
                        if (header === '規格') matchedField = 'table_settings';
                        if (header === '變體規格') matchedField = 'variant_table_settings';

                        if (matchedField) autoMapping[matchedField] = index;
                    });

                    const REVERSE_STATUS_MAP: Record<string, string> = {
                        '上架中': 'active', '上架': 'active',
                        '已停售': 'discontinued', '停產': 'discontinued', '停售': 'discontinued',
                        '預購中': 'preorder', '預購': 'preorder',
                        '售完停產': 'sold_out', '缺貨': 'sold_out', '售完': 'sold_out',
                    };

                    const parseStatus = (val: string, defaultVal: string): any => {
                        const v = val.trim();
                        if (!v) return defaultVal;
                        if (REVERSE_STATUS_MAP[v]) return REVERSE_STATUS_MAP[v];
                        return v.toLowerCase() || defaultVal;
                    };

                    const rawParsed = rows.slice(1).map(row => {
                        const getField = (field: string): string => {
                            const index = autoMapping[field] ?? -1;
                            return index >= 0 && index < row.length ? row[index].trim() : '';
                        };

                        // Support old table_settings column OR new condensed '規格' column
                        const specRaw = getField('table_settings') || getField('規格');
                        const variantSpecRaw = getField('variant_table_settings') || getField('變體規格');

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
                            product_status: parseStatus(getField('product_status'), 'active'),
                            table_settings: specRaw,
                            variant_sku: getField('variant_sku'),
                            variant_name: getField('variant_name'),
                            option_1: getField('option_1'),
                            option_2: getField('option_2'),
                            option_3: getField('option_3'),
                            variant_wholesale_price: parseFloat(getField('variant_wholesale_price')) || undefined,
                            variant_retail_price: parseFloat(getField('variant_retail_price')) || undefined,
                            variant_status: parseStatus(getField('variant_status'), 'active'),
                            variant_table_settings: variantSpecRaw,
                            barcode: getField('barcode'),
                            device_models: getField('device_models'),
                            variant_device_models: getField('variant_device_models'),
                        };

                        const { errors, hasVariant } = validateRow(baseRow);
                        return { ...baseRow, hasVariant, errors, isValid: errors.length === 0 };
                    });

                    // Batch Fetch Existing Data to perform diff
                    const allSkus = rawParsed.map(r => r.product_sku).filter(Boolean);
                    const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);

                    const runDiff = async () => {
                        const { data: existingProducts } = await supabase.from('products').select('*').in('sku', allSkus);
                        const { data: existingVariants } = await supabase.from('product_variants').select('*').in('sku', allVariantSkus);
                        
                        // Fetch category links for existing products to diff categories correctly
                        const productIds = (existingProducts || []).map(p => p.id);
                        const { data: existingCatLinks } = await (supabase.from('product_category_links' as any) as any)
                            .select('product_id, category_id')
                            .in('product_id', productIds);

                        const enrichedData = rawParsed.map(row => {
                            const product = (existingProducts || []).find(p => p.sku === row.product_sku);
                            const variant = (existingVariants || []).find(v => v.sku === row.variant_sku);

                            const diff: string[] = [];
                            let action: 'create' | 'update' = 'create';

                            if (product) {
                                action = 'update';
                                if (product.name !== row.product_name) diff.push('產品名稱');
                                if (product.base_wholesale_price !== row.base_wholesale_price) diff.push('批發價');
                                if (product.base_retail_price !== row.base_retail_price) diff.push('零售價');
                                
                                if (row.category) {
                                    const links = (existingCatLinks || []).filter((l: any) => l.product_id === product.id);
                                    const currentCatNames = links.map((l: any) => (categories as any[]).find(c => c.id === l.category_id)?.name).filter(Boolean);
                                    if (!currentCatNames.includes(row.category)) diff.push('分類');
                                }
                                const parsedIncoming = row.table_settings?.includes(':') ? parseCondensedSpecs(row.table_settings) : (row.table_settings ? JSON.parse(row.table_settings) : {});
                                if (JSON.stringify(product.table_settings) !== JSON.stringify(parsedIncoming)) diff.push('產品規格');
                            }

                            if (row.variant_sku && variant) {
                                action = 'update';
                                if (variant.name !== row.variant_name) diff.push('變體名稱');
                                if (variant.wholesale_price !== (row.variant_wholesale_price ?? row.base_wholesale_price)) diff.push('變體批發價');
                                if (variant.retail_price !== (row.variant_retail_price ?? row.base_retail_price)) diff.push('變體零售價');
                                const parsedIncomingV = row.variant_table_settings?.includes(':') ? parseCondensedSpecs(row.variant_table_settings) : (row.variant_table_settings ? JSON.parse(row.variant_table_settings) : {});
                                if (JSON.stringify(variant.table_settings) !== JSON.stringify(parsedIncomingV)) diff.push('變體規格');
                            }

                            return { ...row, action, diff };
                        });

                        setImportData(enrichedData);
                        setStep('preview');
                    };

                    runDiff();
                },
                error: (error) => toast.error(`解析失敗：${error.message}`)
            });
        };
        reader.readAsArrayBuffer(file);
    }, [specDefs]);

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
                table_settings: row.table_settings ? (row.table_settings.includes(':') ? parseCondensedSpecs(row.table_settings) : JSON.parse(row.table_settings)) : {},
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
                table_settings: row.variant_table_settings ? (row.variant_table_settings.includes(':') ? parseCondensedSpecs(row.variant_table_settings) : JSON.parse(row.variant_table_settings)) : {},
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
            'product_sku,product_name,description,category,brand,model,series,device_models,base_wholesale_price,base_retail_price,product_status,規格,variant_sku,variant_name,option_1,option_2,option_3,variant_device_models,variant_wholesale_price,variant_retail_price,variant_status,變體規格,barcode',
            'PROD-001,基本款T恤,純棉舒適T恤,服飾,品牌A,T系列,日常款,iPhone 15,100,150,active,"材質:純棉, 領型:圓領",,,,,,,,,,',
            'SHIRT-001,彩色襯衫,渲染襯衫,服飾,品牌A,系列2,派對款,,100,150,active,"材質:麻",SHIRT-001-RED-S,紅色 S,紅色,S,,iPhone 14,,,,"顏色:紅色",',
        ].join('\n');
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = '產品匯入範本.csv';
        link.click();
    };

    const [filterStatus, setFilterStatus] = useState<string>('all');

    const filteredData = importData.filter(r => {
        const matchCat = filterCategory === 'all' || r.category === filterCategory;
        const matchStatus = filterStatus === 'all' || 
            (filterStatus === 'changed' && r.action === 'update' && r.diff && r.diff.length > 0) ||
            (filterStatus === 'new' && r.action === 'create') ||
            (filterStatus === 'error' && !r.isValid);
        return matchCat && matchStatus;
    });

    return {
        step, setStep, importData, filteredData, filterCategory, setFilterCategory, 
        filterStatus, setFilterStatus, isLoading: importMutation.isPending,
        handleFileUpload, updateRow, removeRow, importMutation, downloadTemplate, resetState, categories
    };
}
