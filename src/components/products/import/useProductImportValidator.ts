import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deserializeSpecs, formatSpecValue } from '@/utils/specLogic';
import { ImportRow } from './useProductImport';

export function useProductImportValidator(
    allColors: any[],
    allDeviceModels: any[],
    allDeviceGroups: any[],
    categories: any[]
) {
    const validateRow = useCallback((
        row: Omit<ImportRow, 'errors' | 'isValid' | 'is_variant'>
    ): { errors: string[]; is_variant: boolean } => {
        const errors: string[] = [];
        if (!row.product_sku) errors.push('產品 SKU 為必填');
        if (!row.product_name) errors.push('產品名稱為必填');

        const is_variant = typeof (row as any).is_variant === 'boolean'
            ? (row as any).is_variant
            : !!(row.variant_sku || row.variant_name);

        if (is_variant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填');
            if (!row.variant_name) errors.push('變體名稱為必填');
        }

        if (row.brand && !row.brand_id) {
            errors.push(`找不到品牌 "${row.brand}"`);
        }

        if (row.category && !row.category_id) {
            errors.push(`找不到分類 "${row.category}"`);
        }

        if (row.option_3 && is_variant) {
            const searchColor = row.option_3.trim().toLowerCase();
            const colorExists = allColors.some(c =>
                (c.name?.trim().toLowerCase() === searchColor) ||
                (c.code?.trim().toLowerCase() === searchColor)
            );
            if (!colorExists) errors.push(`顏色 "${row.option_3}" 不存在於顏色庫`);
        }

        const checkModels = (modelStr: string | undefined, fieldName: string) => {
            if (!modelStr) return;
            const parts = modelStr.split(',').map(s => s.trim()).filter(Boolean);
            parts.forEach(part => {
                let name = part;
                let type: 'group' | 'model' | 'exclude' | 'auto' = 'auto';
                const lowerPart = part.toLowerCase();

                if (lowerPart.startsWith('group:')) { type = 'group'; name = part.substring(6).trim(); }
                else if (lowerPart.startsWith('exclude:')) { type = 'exclude'; name = part.substring(8).trim(); }
                else if (lowerPart.startsWith('model:')) { type = 'model'; name = part.substring(6).trim(); }

                if (type === 'group') {
                    if (!allDeviceGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
                        errors.push(`${fieldName}: 找不到型號群組 "${name}"`);
                    }
                } else if (type === 'exclude' || type === 'model') {
                    const exists = allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    );
                    if (!exists) errors.push(`${fieldName}: 找不到${type === 'exclude' ? '排除' : ''}型號 "${name}"`);
                } else {
                    const hasGroup = allDeviceGroups.some(g => g.name.toLowerCase() === name.toLowerCase());
                    const hasModel = allDeviceModels.some(m =>
                        (m.name?.trim().toLowerCase() === name.toLowerCase()) ||
                        (Array.isArray(m.aliases) && m.aliases.some((a: string) => a?.trim().toLowerCase() === name.toLowerCase()))
                    );
                    if (!hasGroup && !hasModel) {
                        errors.push(`${fieldName}: 找不到型號或型號群組 "${name}"`);
                    }
                }
            });
        };

        checkModels(row.device_models, '主商品型號');
        if (is_variant) checkModels(row.variant_device_models, '變體型號');

        return { errors, is_variant };
    }, [allColors, allDeviceModels, allDeviceGroups]);

    const enrichWithDiff = useCallback(async (rawParsed: ImportRow[]): Promise<ImportRow[]> => {
        const allSkus = rawParsed.map(r => r.product_sku).filter(Boolean);
        const allVariantSkus = rawParsed.map(r => r.variant_sku).filter(Boolean);
        const allIds = rawParsed.map(r => r.product_id || r.variant_id).filter(Boolean);

        const { data: existingProducts } = await supabase.from('products').select('*')
            .or(`sku.in.(${allSkus.join(',')})${allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''}`);

        const { data: existingVariants } = await supabase.from('product_variants').select('*')
            .or(`sku.in.(${allVariantSkus.join(',')})${allIds.length > 0 ? `,id.in.(${allIds.join(',')})` : ''}`);

        return rawParsed.map(row => {
            const product = (existingProducts || []).find(p =>
                (row.product_id && p.id === row.product_id) || p.sku === row.product_sku
            );
            const variant = (existingVariants || []).find(v =>
                (row.variant_id && v.id === row.variant_id) || v.sku === row.variant_sku
            );

            const diff: string[] = [];
            let action: 'create' | 'update' = 'create';

            if (product) {
                action = 'update';
                row.product_id = product.id;
                row.spec_values = product.spec_values;

                if (product.name !== row.product_name) diff.push('產品名稱');
                if (product.description !== row.description) diff.push('描述');
                if (product.model !== row.model) diff.push('型號');
                if (product.series !== row.series) diff.push('系列');
                if (product.brand_id !== row.brand_id) diff.push('品牌');
                if (Number(product.base_wholesale_price) !== Number(row.base_wholesale_price)) diff.push('批發價');
                if (Number(product.base_retail_price) !== Number(row.base_retail_price)) diff.push('零售價');
                if (product.status !== row.product_status) diff.push('狀態');
                if (product.barcode !== row.barcode) diff.push('條碼');
                if (product.color !== row.option_3) diff.push('顏色');

                const incomingSpecs = row._specs || {};
                if (Object.keys(incomingSpecs).length > 0) {
                    const currentSpecs = deserializeSpecs(product.spec_values);
                    const hasSpecDiff = Object.entries(incomingSpecs).some(([key, val]) => {
                        const [pId, sId] = key.split(':');
                        const matchingKey = Object.keys(currentSpecs).find(k => {
                            const parts = k.split(':');
                            return parts[0] === pId && parts[1] === sId;
                        });
                        const currentVal = matchingKey ? currentSpecs[matchingKey] : undefined;
                        return formatSpecValue(currentVal) !== String(val);
                    });
                    if (hasSpecDiff) diff.push('產品規格');
                }
            }

            if (row.variant_sku && variant) {
                action = 'update';
                row.variant_id = variant.id;
                row.variant_spec_values = variant.spec_values;

                if (variant.name !== row.variant_name) diff.push('變體名稱');
                if (variant.option_1 !== row.option_1) diff.push('變體選項1');
                if (variant.option_2 !== row.option_2) diff.push('變體選項2');
                if (variant.option_3 !== row.option_3) diff.push('變體選項3');
                if (Number(variant.wholesale_price) !== Number(row.variant_wholesale_price || row.base_wholesale_price)) diff.push('變體批發價');
                if (Number(variant.retail_price) !== Number(row.variant_retail_price || row.base_retail_price)) diff.push('變體零售價');
                if (variant.status !== (row.variant_status || row.product_status)) diff.push('變體狀態');
                if (variant.barcode !== row.barcode) diff.push('變體條碼');
            }

            const { errors } = validateRow(row as any);
            return { ...row, errors, isValid: errors.length === 0, action, diff };
        });
    }, [validateRow]);

    return { validateRow, enrichWithDiff };
}
