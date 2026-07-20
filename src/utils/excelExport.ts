import * as XLSX from 'xlsx';
import { CategorySpec } from '@/hooks/useCategorySpecs';
import { formatSpecValue } from './specLogic';

export const BASE_COLUMNS = {
    'ID': 'id',
    '產品類型': 'is_variant',
    'SKU': 'sku',
    '產品名稱': 'name',
    '變體 SKU': 'variant_sku',
    '變體名稱': 'variant_name',
    '描述': 'description',
    '品牌': 'brand',
    '型號': 'model',
    '系列': 'series',
    '適用型號': 'device_models',
    '批發價': 'wholesale_price',
    '零售價': 'retail_price',
    '狀態': 'status',
    '條碼': 'barcode',
    '分類': 'category',
    '規格 1': 'option_1',
    '規格 2': 'option_2',
    '顏色 (規格 3)': 'option_3',
} as const;

export type BaseColumnKey = keyof typeof BASE_COLUMNS;

export function generateProductExcel(
    products: any[],
    categories: any[],
    specDefs: any[],
    specLinks: any[] = [],
    brandMap: Record<string, string> = {},
    seriesMap: Record<string, string> = {}
) {
    const workbook = XLSX.utils.book_new();

    const specMap = new Map<string, CategorySpec>();
    specDefs.forEach(d => { specMap.set(d.id, d); });

    const categoryGroups: Record<string, any[]> = {};
    const categoryInfoMap: Record<string, { name: string, sort_order: number }> = {};
    categories.forEach(c => {
        categoryInfoMap[c.id] = { name: c.name, sort_order: c.sort_order || 0 };
    });

    products.forEach(p => {
        const catIds = (p.category_ids && p.category_ids.length > 0) ? p.category_ids : ['unclassified'];

        catIds.forEach((catId: string) => {
            if (!categoryGroups[catId]) categoryGroups[catId] = [];
            categoryGroups[catId].push({ ...p, _currentCatId: catId === 'unclassified' ? null : catId });
        });
    });

    const sortedCatIds = Object.keys(categoryGroups).sort((a, b) => {
        if (a === 'unclassified') return 1;
        if (b === 'unclassified') return -1;
        return (categoryInfoMap[a]?.sort_order || 0) - (categoryInfoMap[b]?.sort_order || 0);
    });

    sortedCatIds.forEach(catId => {
        const groupProducts = categoryGroups[catId];
        const catName = catId === 'unclassified' ? '未分類' : (categoryInfoMap[catId]?.name || '未知分類');
        const currentCatId = catId === 'unclassified' ? null : catId;

        const definedSpecKeys: { key: string, name: string, path: string }[] = [];

        const childrenMap = new Map<string, string[]>();
        specDefs.forEach(spec => {
            const triggers = spec.logic_config?.triggers || spec.logicConfig?.triggers || [];
            const targets = new Set<string>();
            triggers.forEach((t: any) => {
                const tars = t.targets || (t as any).target_ids?.map((tid: string) => ({ id: tid })) || [];
                tars.forEach((tar: any) => targets.add(tar.id));
            });
            if (targets.size > 0) {
                childrenMap.set(spec.id, Array.from(targets));
            }
        });

        const processedKeys = new Set<string>();
        const collectSpecs = (specId: string, parentId: string, parentPath: string = '') => {
            const spec = specMap.get(specId);
            if (!spec) return;

            const key = `${parentId}:${specId}`;
            if (processedKeys.has(key)) return;
            processedKeys.add(key);

            const currentPath = parentPath ? `${parentPath} > ${spec.name}` : spec.name;
            const displayName = parentPath ? `[${parentPath.split(' > ').pop()}] ${spec.name}` : spec.name;

            definedSpecKeys.push({ key, name: displayName, path: currentPath });

            const children = childrenMap.get(specId) || [];
            children.forEach(childId => {
                collectSpecs(childId, specId, currentPath);
            });
        };

        if (currentCatId) {
            const allCatIdsForGroup = new Set<string>();
            groupProducts.forEach(p => {
                if (Array.isArray(p.category_ids)) {
                    p.category_ids.forEach((id: string) => allCatIdsForGroup.add(id));
                }
            });
            allCatIdsForGroup.add(currentCatId);

            const rawLinks = specLinks
                .filter(link => allCatIdsForGroup.has(link.category_id))
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

            const uniqueSpecIds = new Set<string>();
            const links = rawLinks.filter(l => {
                if (uniqueSpecIds.has(l.spec_id)) return false;
                uniqueSpecIds.add(l.spec_id);
                return true;
            });

            const allChildIds = new Set<string>();
            specDefs.forEach(s => {
                const children = childrenMap.get(s.id) || [];
                children.forEach(cid => allChildIds.add(cid));
            });

            links.forEach(link => {
                if (!allChildIds.has(link.spec_id)) {
                    collectSpecs(link.spec_id, 'root');
                }
            });
        } else {
            const linkedSpecIds = new Set(specLinks.map(l => l.spec_id));
            const activeKeys = new Set<string>();
            groupProducts.forEach(p => {
                const settings = p.spec_values;
                if (Array.isArray(settings)) {
                    settings.forEach((s: any) => {
                        if (!linkedSpecIds.has(s.id)) {
                            activeKeys.add(`root:${s.id}`);
                        }
                    });
                }
            });

            Array.from(activeKeys).forEach(key => {
                const [_, specId] = key.split(':');
                const spec = specMap.get(specId);
                if (spec) {
                    definedSpecKeys.push({ key, name: spec.name, path: spec.name });
                }
            });
        }

        const row1Names = [...Object.keys(BASE_COLUMNS)];
        const row2Instructions = [...Object.keys(BASE_COLUMNS).map(() => '')];
        const row3Paths = [...Object.keys(BASE_COLUMNS).map(() => '')];
        const row4Ids = [...Object.values(BASE_COLUMNS) as string[]];

        const baseKeys = Object.keys(BASE_COLUMNS);

        const statusColIndex = baseKeys.indexOf('狀態');
        if (statusColIndex >= 0) row2Instructions[statusColIndex] = '上架中, 已停售, 預購中, 售完停產';

        const modelColIndex = baseKeys.indexOf('適用型號');
        if (modelColIndex >= 0) row2Instructions[modelColIndex] = '多個用逗號分隔。\n特定寫法:\ngroup:名稱\nexclude:名稱';

        definedSpecKeys.forEach(spec => {
            row1Names.push(spec.name);
            row3Paths.push(spec.path);
            row4Ids.push(spec.key);

            let instruction = '';
            const specId = spec.key.split(':').pop();
            if (specId) {
                const specData = specMap.get(specId);
                if (specData && Array.isArray(specData.options) && specData.options.length > 0) {
                    instruction = `可選值:\n${specData.options.join('\n')}`;
                }
            }
            row2Instructions.push(instruction);
        });

        const rows: any[] = [row1Names, row2Instructions, row3Paths, row4Ids];

        groupProducts.forEach(p => {
            rows.push(buildRowV3(p, false, row4Ids, brandMap, specMap, undefined, seriesMap));
            if (p.variants && p.variants.length > 0) {
                p.variants.forEach((v: any) => {
                    rows.push(buildRowV3(v, true, row4Ids, brandMap, specMap, p, seriesMap));
                });
            }
        });

        const worksheet = XLSX.utils.aoa_to_sheet(rows);

        const wscols = row1Names.map((h, i) => ({
            wch: Math.max(h.length * 2, 12),
            hidden: i === 0
        }));
        worksheet['!cols'] = wscols;

        if (!worksheet['!rows']) worksheet['!rows'] = [];
        worksheet['!rows'][1] = { hpt: 45 };
        worksheet['!rows'][2] = { hidden: true };
        worksheet['!rows'][3] = { hidden: true };

        worksheet['!view'] = [{ state: 'frozen', ySplit: 4 }];

        const sanitizedCatName = catName.replace(/[:\\/?*\[\]]/g, '_').substring(0, 31);
        XLSX.utils.book_append_sheet(workbook, worksheet, sanitizedCatName);
    });

    return workbook;
}

function buildRowV3(item: any, isVariant: boolean, headerIds: string[], brandMap: Record<string, string>, specMap: Map<string, CategorySpec>, parent?: any, seriesMap: Record<string, string> = {}) {
    const row: any[] = [];

    let categoryName = '';
    if (isVariant && parent?.category_names) {
        categoryName = Array.isArray(parent.category_names) ? parent.category_names.join(', ') : parent.category_names;
    } else if (item.category_names) {
        categoryName = Array.isArray(item.category_names) ? item.category_names.join(', ') : item.category_names;
    } else if (item.category) {
        categoryName = item.category;
    }
    const STATUS_MAP: Record<string, string> = {
        'active': '上架中',
        'discontinued': '已停售',
        'preorder': '預購中',
        'sold_out': '售完停產',
    };

    const baseValues: Record<string, any> = {
        id: item.id || '',
        is_variant: isVariant ? '變體' : '主商品',
        sku: isVariant ? (parent?.sku || '') : (item.sku || ''),
        name: isVariant ? (parent?.name || '') : (item.name || ''),
        variant_sku: isVariant ? (item.sku || '') : '',
        variant_name: isVariant ? (item.name || '') : '',
        description: item.description || parent?.description || '',
        brand: (item.brand_id || parent?.brand_id) ? (brandMap[item.brand_id || parent?.brand_id] || '') : '',
        model: item.model || parent?.model || '',
        series: seriesMap[item.brand_series_ids?.[0] || parent?.brand_series_ids?.[0]] || '',
        wholesale_price: isVariant ? (item.wholesale_price || 0) : (item.base_wholesale_price || 0),
        retail_price: isVariant ? (item.retail_price || 0) : (item.base_retail_price || 0),
        status: STATUS_MAP[item.status || 'active'] || '上架中',
        barcode: item.barcode || '',
        category: categoryName,
        device_models: '',
        option_1: item.option_1 || '',
        option_2: item.option_2 || '',
        option_3: item.color || item.option_3 || '',
    };

    let deviceModelValue = '';
    if (Array.isArray(item.device_model_rules) && item.device_model_rules.length > 0) {
        deviceModelValue = item.device_model_rules.join(', ');
    } else {
        const modelParts: string[] = [];
        if (Array.isArray(item.device_models)) {
            item.device_models.forEach((m: any) => {
                const name = typeof m === 'string' ? m : m.name;
                if (name) modelParts.push(`model:${name}`);
            });
        }
        if (Array.isArray(item.device_model_groups)) {
            item.device_model_groups.forEach((g: any) => {
                if (typeof g === 'string') modelParts.push(`group:${g}`);
            });
        }
        if (Array.isArray(item.device_model_exclusions)) {
            item.device_model_exclusions.forEach((e: any) => {
                const name = typeof e === 'string' ? e : e.name;
                if (name) modelParts.push(`exclude:${name}`);
            });
        }
        deviceModelValue = modelParts.join(', ');
    }

    baseValues.device_models = deviceModelValue;

    const settings = item.spec_values || {};

    headerIds.forEach(key => {
        if (baseValues[key] !== undefined) {
            row.push(baseValues[key]);
        } else {
            const [parentId, specId] = key.split(':');
            const spec = specMap.get(specId);
            let val = undefined;

            const matchingKey = Object.keys(settings).find(k => {
                const parts = k.split(':');
                const kSpecId = parts[1];
                const kParentId = parts[0];
                return kSpecId === specId && kParentId === parentId;
            });

            if (matchingKey) {
                val = settings[matchingKey];
            } else if (parentId === 'root') {
                val = settings[specId];
            }

            row.push(formatSpecValue(val, spec, specMap) || '');
        }
    });

    return row;
}
