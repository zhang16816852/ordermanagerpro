import { supabase } from '@/integrations/supabase/client';
import type { OptionGroupInput, OptionGroupSuggestion, SharedVariant } from '@/utils/variantGeneration';
import { findLibraryColor, isColorGroupName } from '@/utils/variantGeneration';
import type { DeviceSelectionRef } from '../StandaloneDeviceModelSelectField';
import type { DiffSummary, Product } from './variantBatchCreatorTypes';

export interface LoadedBatchData {
  optionGroups: OptionGroupInput[];
  dbValueToColorId: Map<string, string>;
  dbVariants: SharedVariant[];
  selectedDeviceRefs: DeviceSelectionRef[];
}

interface DeviceRefItem {
  name: string;
  id: string;
  type: 'model' | 'group';
}

export const identityKey = (v: SharedVariant): string => {
  const opts = [...v.optionValueIds].sort().join('|');
  return `${v._modelGroupId ?? ''}::${opts}`;
};

export function resolveDeviceItems(
  selectedDeviceRefs: DeviceSelectionRef[],
  models: { id: string; name: string }[],
  groups: { id: string; name: string }[],
): DeviceRefItem[] {
  return selectedDeviceRefs
    .map(ref => {
      if (ref.type === 'model') {
        const m = models.find(m => m.id === ref.id);
        return m ? { name: m.name, id: m.id, type: 'model' as const } : null;
      }
      const g = groups.find(g => g.id === ref.id);
      return g ? { name: g.name, id: g.id, type: 'group' as const } : null;
    })
    .filter((x): x is DeviceRefItem => !!x);
}

export function mergeWithExisting(
  newVariants: SharedVariant[],
  existingList: SharedVariant[],
  dbList: SharedVariant[],
): { merged: SharedVariant[]; diff: DiffSummary } {
  const existingByKey = new Map(existingList.map(ev => [identityKey(ev), ev]));
  const dbByKey = new Map(dbList.map(ev => [identityKey(ev), ev]));
  const newKeys = new Set(newVariants.map(identityKey));

  const removed = existingList.filter(ev => !newKeys.has(identityKey(ev)));
  let kept = 0;
  let updated = 0;
  let priceUpdated = 0;

  const merged = newVariants.map(newV => {
    const key = identityKey(newV);
    const dbMatch = dbByKey.get(key);
    const existing = existingByKey.get(key);
    if (dbMatch) {
      kept++;
      updated++;
      if (existing && (existing.wholesale_price !== newV.wholesale_price || existing.retail_price !== newV.retail_price)) {
        priceUpdated++;
      }
      // 保留既有 SKU，讓 RPC 依 SKU UPSERT 就地更新而不產生重複或孤兒
      return {
        ...newV,
        sku: dbMatch.sku,
        barcode: dbMatch.barcode || existing?.barcode || newV.barcode,
        _dbId: dbMatch._dbId,
      };
    }
    if (existing) {
      kept++;
      if (existing.wholesale_price !== newV.wholesale_price || existing.retail_price !== newV.retail_price) {
        priceUpdated++;
      }
      return { ...newV, barcode: existing.barcode };
    }
    return newV;
  });

  // 既有 DB 變體中，SKU 不在合併結果內的 → 將不會被生成（潛在孤兒）
  const mergedSkuSet = new Set(merged.map(v => v.sku));
  const orphans = dbList.filter(v => !mergedSkuSet.has(v.sku));

  const diff: DiffSummary = {
    added: merged.length - kept,
    kept,
    updated,
    removed,
    orphans,
    priceUpdated,
  };
  return { merged, diff };
}

export async function loadExistingBatchData(
  product: Product,
  libraryColors: { id: string; name: string; code: string; hex_code?: string | null }[],
): Promise<LoadedBatchData> {
  const dbValueToColorId = new Map<string, string>();

  // 1. Load existing option groups with values
  const { data: groups, error: gErr } = await supabase
    .from('product_option_groups')
    .select('*, product_option_values(*)')
    .eq('product_id', product.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (gErr) throw gErr;

  let optionGroups: OptionGroupInput[] = [];

  if (groups && groups.length > 0) {
    optionGroups = groups.map(g => {
      const isColorGroup = isColorGroupName(g.name);

      return {
        id: g.id,
        name: g.name,
        values: (g.product_option_values || [])
          .sort((a: any, b: any) =>
            (a.sort_order || 0) - (b.sort_order || 0) ||
            +new Date(a.created_at) - +new Date(b.created_at)
          )
          .map((v: any) => {
            const libColor = isColorGroup
              ? findLibraryColor(
                libraryColors,
                {
                  label: v.label,
                  value: v.value,
                }
              )
              : undefined;

            if (isColorGroup && libColor) {
              dbValueToColorId.set(
                v.id,
                `color-${libColor.id}`
              );
            }

            return {
              id: dbValueToColorId.get(v.id) ?? v.id,
              label: v.label,
              value: libColor?.code ?? v.value,
              wholesalePrice: '',
              retailPrice: '',
              hexCode: v.hex_code || '',
            };
          }),
      };
    });
  }

  // 2. Load existing variants
  const { data: variants, error: vErr } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', product.id)
    .order('sort_order', { ascending: true });

  if (vErr) throw vErr;

  if (!variants || variants.length === 0) {
    return { optionGroups, dbValueToColorId, dbVariants: [], selectedDeviceRefs: [] };
  }

  // 3. Load variant-option links
  const variantIds = variants.map(v => v.id);
  const { data: variantOptions } = await supabase
    .from('product_variant_options')
    .select('*')
    .in('variant_id', variantIds);

  const variantOptionMap = new Map<string, string[]>();
  variantOptions?.forEach(vo => {
    const list = variantOptionMap.get(vo.variant_id) || [];
    list.push(vo.option_value_id);
    variantOptionMap.set(vo.variant_id, list);
  });

  // 4. Load device model relations
  const { data: relations } = await supabase
    .from('entity_model_relations')
    .select('variant_id, model_id, group_id, sort_order')
    .in('variant_id', variantIds)
    .eq('relation_type', 'include')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  const variantModelMap = new Map<string, { id: string; type: 'model' | 'group' }[]>();
  const seenRefs = new Set<string>();
  const orderedRefs: DeviceSelectionRef[] = [];
  relations?.forEach(r => {
    if (r.model_id) {
      const key = `model:${r.model_id}`;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        orderedRefs.push({ id: r.model_id, type: 'model' });
      }
      if (r.variant_id) {
        const list = variantModelMap.get(r.variant_id) || [];
        list.push({ id: r.model_id, type: 'model' });
        variantModelMap.set(r.variant_id, list);
      }
    }
    if (r.group_id) {
      const key = `group:${r.group_id}`;
      if (!seenRefs.has(key)) {
        seenRefs.add(key);
        orderedRefs.push({ id: r.group_id, type: 'group' });
      }
      if (r.variant_id) {
        const list = variantModelMap.get(r.variant_id) || [];
        list.push({ id: r.group_id, type: 'group' });
        variantModelMap.set(r.variant_id, list);
      }
    }
  });

  const isPerVariant = relations && relations.length > 0 &&
    relations.length === variantIds.length &&
    Array.from(variantModelMap.values()).every(list => list.length === 1);

  // 5. Populate preview
  const dbVariants: SharedVariant[] = variants.map(v => {
    const mappings = variantModelMap.get(v.id);
    const singleMapping = isPerVariant && mappings?.length === 1 ? mappings[0] : undefined;
    return {
      sku: v.sku,
      name: v.name,
      barcode: v.barcode || '',
      wholesale_price: v.wholesale_price,
      retail_price: v.retail_price,
      sort_order: v.sort_order,
      optionValueIds: (variantOptionMap.get(v.id) || []).map(id => dbValueToColorId.get(id) ?? id),
      _modelGroupId: singleMapping?.id,
      _modelGroupType: singleMapping?.type,
      _dbId: v.id,
    };
  });

  return { optionGroups, dbValueToColorId, dbVariants, selectedDeviceRefs: orderedRefs };
}

export async function fetchOptionSuggestions(product: Product): Promise<OptionGroupSuggestion[]> {
  const { data: productCategories, error: catErr } = await supabase
    .from('product_category_links')
    .select('category_id')
    .eq('product_id', product.id);

  if (catErr) throw catErr;
  const categoryIds = [...new Set((productCategories || []).map(l => l.category_id))];
  if (categoryIds.length === 0) return [];

  const { data: siblingLinks, error: siblingErr } = await supabase
    .from('product_category_links')
    .select('product_id')
    .in('category_id', categoryIds)
    .is('variant_id', null)
    .neq('product_id', product.id);

  if (siblingErr) throw siblingErr;
  const siblingIds = [...new Set((siblingLinks || []).map(l => l.product_id))];
  if (siblingIds.length === 0) return [];

  const { data: groups, error: groupsErr } = await supabase
    .from('product_option_groups')
    .select('*, product_option_values(*)')
    .in('product_id', siblingIds)
    .order('sort_order');

  if (groupsErr) throw groupsErr;

  const byName = new Map<string, Map<string, { label: string; value: string; hexCode: string }>>();
  for (const g of (groups || []) as any[]) {
    const name = (g.name || '').trim();
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, new Map());
    const valueMap = byName.get(name)!;
    for (const v of (g.product_option_values || []) as any[]) {
      const label = (v.label || '').trim();
      if (!label) continue;
      if (!valueMap.has(label)) {
        valueMap.set(label, { label, value: v.value || label, hexCode: v.hex_code || '' });
      }
    }
  }

  const loaded: OptionGroupSuggestion[] = [];
  byName.forEach((valueMap, name) => {
    const values = Array.from(valueMap.values());
    if (values.length === 0) return;
    loaded.push({ name, values });
  });

  return loaded;
}