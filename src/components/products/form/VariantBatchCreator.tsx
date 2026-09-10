import { useEffect, useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { getContrastColor } from '@/utils/colorUtils';
import { Layers, Sparkles, AlertCircle, Plus, X, GripVertical } from 'lucide-react';
import { StandaloneDeviceModelSelectField, type DeviceSelectionRef } from '../StandaloneDeviceModelSelectField';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { ColorSelectField } from './ColorSelectField';
import { useColorStore } from '@/store/useColorStore';
import type { ProductColor } from '@/types/colors';

type Product = Tables<'products'>;

const COLOR_GROUP_NAME_RE = /(顏色|色|color)/i;

function isColorGroupName(name: string): boolean {
  return COLOR_GROUP_NAME_RE.test(name);
}

function findLibraryColor(colors: ProductColor[], value: OptionValueInput): ProductColor | undefined {
  if (!value.label) return undefined;
  const byName = colors.find(c => c.name.trim().toLowerCase() === value.label.trim().toLowerCase());
  if (byName) return byName;
  if (value.value) {
    return colors.find(c => c.code.toUpperCase() === value.value.trim().toUpperCase());
  }
  return undefined;
}

interface VariantBatchCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess: () => void;
}

interface OptionValueInput {
  id: string;
  label: string;
  value: string;
  wholesalePrice: string;
  retailPrice: string;
  hexCode: string;
}

interface OptionGroupInput {
  id: string;
  name: string;
  values: OptionValueInput[];
}

interface OptionGroupSuggestion {
  name: string;
  values: { label: string; value: string; hexCode: string }[];
}

interface GeneratedVariant {
  sku: string;
  name: string;
  barcode: string;
  wholesale_price: number;
  retail_price: number;
  sort_order: number;
  optionValueIds: string[];
  _modelGroupId?: string;
  _modelGroupType?: 'model' | 'group';
}

function createOptionValue(
  label = '',
  value = '',
  wholesalePrice = '',
  retailPrice = '',
  hexCode = '',
): OptionValueInput {
  return { id: crypto.randomUUID(), label, value, wholesalePrice, retailPrice, hexCode };
}

function createOptionGroup(name = ''): OptionGroupInput {
  return { id: crypto.randomUUID(), name, values: [] };
}

interface OptionValueTableProps {
  values: OptionValueInput[];
  onUpdate: (id: string, field: keyof OptionValueInput, value: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onBulkPaste: () => void;
}

function OptionValueTable({ values, onUpdate, onRemove, onAdd, onBulkPaste }: OptionValueTableProps) {
  return (
    <div className="space-y-2">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-1.5 text-left">名稱 (Label)</th>
              <th className="px-2 py-1.5 text-left w-[90px]">SKU 值</th>
              <th className="px-2 py-1.5 text-right w-[80px]">批發價</th>
              <th className="px-2 py-1.5 text-right w-[80px]">零售價</th>
              <th className="px-2 py-1.5 w-[60px]">色碼</th>
              <th className="px-2 py-1.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {values.length === 0 ? (
              <tr className="border-t">
                <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-sm">
                  尚無選項值，請按下方按鈕新增，或使用批量貼上
                </td>
              </tr>
            ) : values.map(v => (
              <tr key={v.id} className="border-t">
                <td className="px-2 py-1">
                  <Input
                    value={v.label}
                    onChange={e => onUpdate(v.id, 'label', e.target.value)}
                    className="h-8"
                    placeholder="顯示名稱"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={v.value}
                    onChange={e => onUpdate(v.id, 'value', e.target.value)}
                    className="h-8"
                    placeholder="留空=名稱"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={v.wholesalePrice}
                    onChange={e => onUpdate(v.id, 'wholesalePrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={v.retailPrice}
                    onChange={e => onUpdate(v.id, 'retailPrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-2 py-1">
                  <div className="flex items-center gap-1">
                    <Input
                      value={v.hexCode}
                      onChange={e => onUpdate(v.id, 'hexCode', e.target.value)}
                      className="h-8 w-[36px] font-mono text-xs px-1"
                      placeholder="#"
                      maxLength={7}
                    />
                    {v.hexCode && /^#[0-9a-fA-F]{6}$/.test(v.hexCode) && (
                      <div
                        className="w-5 h-5 rounded border shrink-0"
                        style={{ backgroundColor: v.hexCode }}
                      />
                    )}
                  </div>
                </td>
                <td className="px-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => onRemove(v.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onAdd}>
          + 新增項目
        </Button>
        <Button variant="outline" size="sm" onClick={onBulkPaste}>
          批量貼上
        </Button>
      </div>
    </div>
  );
}

export function VariantBatchCreator({ open, onOpenChange, product, onSuccess }: VariantBatchCreatorProps) {
  const [optionGroups, setOptionGroups] = useState<OptionGroupInput[]>([]);
  const [bulkPasteTargetGroupId, setBulkPasteTargetGroupId] = useState<string | null>(null);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [barcodeList, setBarcodeList] = useState('');
  const [selectedDeviceRefs, setSelectedDeviceRefs] = useState<DeviceSelectionRef[]>([]);
  const selectedModelIds = selectedDeviceRefs.filter(r => r.type === 'model').map(r => r.id);
  const selectedGroupIds = selectedDeviceRefs.filter(r => r.type === 'group').map(r => r.id);
  const [defaultWholesalePrice, setDefaultWholesalePrice] = useState('');
  const [defaultRetailPrice, setDefaultRetailPrice] = useState('');
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([]);
  const [diffSummary, setDiffSummary] = useState<{ added: number; kept: number; removed: GeneratedVariant[]; priceUpdated: number } | null>(null);
  const isUnified = !!product?.unified_pricing;
  const loadExistingDataDbValueToColorId = useRef(new Map<string, string>());
  const [suggestions, setSuggestions] = useState<OptionGroupSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const { models: deviceModels, groups: deviceGroups, fetchData: fetchDeviceData } = useDeviceModelStore();
  const { colors: libraryColors, fetchColors } = useColorStore();

  useEffect(() => {
    const init = async () => {
      if (open) {
        await Promise.all([
          fetchDeviceData(),
          fetchColors(),
        ]);
        await loadExistingData();
        fetchSuggestions();
      }
    };
    init();
  }, [open, fetchDeviceData, fetchColors]);

  const loadExistingData = async () => {
    try {
      setDiffSummary(null);

      loadExistingDataDbValueToColorId.current = new Map();
      // 1. Load existing option groups with values
      const { data: groups, error: gErr } = await supabase
        .from('product_option_groups')
        .select('*, product_option_values(*)')
        .eq('product_id', product.id)
        .order('sort_order', { ascending: true });

      if (gErr) throw gErr;

      if (groups && groups.length > 0) {
        const dbValueToColorId = new Map<string, string>();

        const loaded: OptionGroupInput[] = groups.map(g => {
          const isColorGroup = isColorGroupName(g.name);

          return {
            id: g.id,
            name: g.name,
            values: (g.product_option_values || [])
              .sort((a: any, b: any) =>
                (a.sort_order || 0) - (b.sort_order || 0)
              )
              .map((v: any) => {
                const libColor = isColorGroup
                  ? findLibraryColor(
                    libraryColors,
                    {
                      label: v.label,
                      value: v.value,
                    } as OptionValueInput
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

        setOptionGroups(loaded);
        loadExistingDataDbValueToColorId.current = dbValueToColorId;
      } else {
        // DB 沒有任何 option group 時，明確清空
        setOptionGroups([]);
        loadExistingDataDbValueToColorId.current = new Map();
      }

      // 2. Load existing variants
      const { data: variants, error: vErr } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', product.id)
        .order('sort_order', { ascending: true });

      if (vErr) throw vErr;

      if (!variants || variants.length === 0) return;

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
      setSelectedDeviceRefs(orderedRefs);

      const isPerVariant = relations && relations.length > 0 &&
        relations.length === variantIds.length &&
        Array.from(variantModelMap.values()).every(list => list.length === 1);

      // 5. Populate preview
      setGeneratedVariants(variants.map(v => {
        const mappings = variantModelMap.get(v.id);
        const singleMapping = isPerVariant && mappings?.length === 1 ? mappings[0] : undefined;
        return {
          sku: v.sku,
          name: v.name,
          barcode: v.barcode || '',
          wholesale_price: v.wholesale_price,
          retail_price: v.retail_price,
          sort_order: v.sort_order,
          optionValueIds: (variantOptionMap.get(v.id) || []).map(id => loadExistingDataDbValueToColorId.current.get(id) ?? id),
          _modelGroupId: singleMapping?.id,
          _modelGroupType: singleMapping?.type,
        };
      }));

      if (variants.length > 0) {
        toast.success(`已載入 ${variants.length} 個現有變體`);
      }
    } catch (err) {
      console.error('載入資料失敗:', err);
    }
  };

  const fetchSuggestions = async () => {
    try {
      setSuggestionsLoading(true);
      const { data: productCategories, error: catErr } = await supabase
        .from('product_category_links')
        .select('category_id')
        .eq('product_id', product.id);

      if (catErr) throw catErr;
      const categoryIds = [...new Set((productCategories || []).map(l => l.category_id))];
      if (categoryIds.length === 0) {
        setSuggestions([]);
        return;
      }

      const { data: siblingLinks, error: siblingErr } = await supabase
        .from('product_category_links')
        .select('product_id')
        .in('category_id', categoryIds)
        .is('variant_id', null)
        .neq('product_id', product.id);

      if (siblingErr) throw siblingErr;
      const siblingIds = [...new Set((siblingLinks || []).map(l => l.product_id))];
      if (siblingIds.length === 0) {
        setSuggestions([]);
        return;
      }

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

      setSuggestions(loaded);
    } catch (err) {
      console.error('載入選項建議失敗:', err);
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const importSuggestion = (sug: OptionGroupSuggestion) => {
    setOptionGroups(prev => {
      const existing = prev.find(g => g.name.trim().toLowerCase() === sug.name.toLowerCase());
      if (existing) {
        return prev.map(g => {
          if (g.id !== existing.id) return g;
          const existingLabels = new Set(g.values.map(v => v.label.trim().toLowerCase()));
          const toAdd = sug.values.filter(v => !existingLabels.has(v.label.trim().toLowerCase()));
          return { ...g, values: [...g.values, ...toAdd.map(v => createOptionValue(v.label, v.value, '', '', v.hexCode))] };
        });
      }
      const group = createOptionGroup(sug.name);
      group.values = sug.values.map(v => createOptionValue(v.label, v.value, '', '', v.hexCode));
      return [...prev, group];
    });
  };

  const importAllSuggestions = () => {
    suggestions.forEach(s => importSuggestion(s));
  };

  const getGroupSelectedColorIds = (values: OptionValueInput[]): string[] => {
    const ids: string[] = [];
    for (const v of values) {
      const match = findLibraryColor(libraryColors, v);
      if (match && !ids.includes(match.id)) ids.push(match.id);
    }
    return ids;
  };

  const syncGroupColors = (groupId: string, colorIds: string[]) => {
    setOptionGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const nonLibrary = g.values.filter(v => !findLibraryColor(libraryColors, v));
      const existingByLabel = new Map<string, OptionValueInput>();
      for (const v of g.values) {
        if (v.label) existingByLabel.set(v.label.trim(), v);
      }
      const selectedValues: OptionValueInput[] = colorIds
        .map(id => libraryColors.find(c => c.id === id))
        .filter((c): c is ProductColor => !!c)
        .map(color => {
          const existing = existingByLabel.get(color.name.trim());
          return {
            id: existing?.id ?? `color-${color.id}`,
            label: color.name,
            value: color.code,
            wholesalePrice: existing?.wholesalePrice ?? '',
            retailPrice: existing?.retailPrice ?? '',
            hexCode: color.hex_code || '',
          };
        });
      return { ...g, values: [...nonLibrary, ...selectedValues] };
    }));
  };

  const resolveDeviceItems = (): { name: string; id: string; type: 'model' | 'group' }[] =>
    selectedDeviceRefs
      .map(ref => {
        if (ref.type === 'model') {
          const m = deviceModels.find(m => m.id === ref.id);
          return m ? { name: m.name, id: m.id, type: 'model' as const } : null;
        }
        const g = deviceGroups.find(g => g.id === ref.id);
        return g ? { name: g.name, id: g.id, type: 'group' as const } : null;
      })
      .filter((x): x is { name: string; id: string; type: 'model' | 'group' } => !!x);

  const generateVariants = () => {
    // Collect non-empty groups (at least one value with a label)
    const activeGroups = optionGroups.filter(g =>
      g.values.some(v => v.label.trim()),
    );

    const unnamedGroups = optionGroups.filter(g => !g.name.trim() && g.values.some(v => v.label.trim()));
    if (unnamedGroups.length > 0) {
      toast.error(`有 ${unnamedGroups.length} 個選項群組未填寫名稱，請補填名稱後再生成`);
      return;
    }

    if (activeGroups.length === 0) {
      // No option groups — only device models path
      const hasModelsOrGroups = selectedModelIds.length > 0 || selectedGroupIds.length > 0;
      if (!hasModelsOrGroups) {
        toast.error('請至少建立一個選項群組並輸入值，或選擇型號/群組');
        return;
      }
      const defaultWholesale = isUnified ? Number(product?.unified_wholesale_price ?? 0) : (parseFloat(defaultWholesalePrice) || 0);
      const defaultRetail = isUnified ? Number(product?.unified_retail_price ?? 0) : (parseFloat(defaultRetailPrice) || 0);

      const modelGroupNames = resolveDeviceItems();

      const codePrefix = product.code || 'PROD';
      const variants: GeneratedVariant[] = modelGroupNames.map((item, idx) => ({
        sku: `${codePrefix}-${item.name}`.toUpperCase().replace(/\s+/g, '-'),
        name: `${product.name} - ${item.name}`,
        barcode: '',
        wholesale_price: defaultWholesale,
        retail_price: defaultRetail,
        sort_order: idx,
        optionValueIds: [],
        _modelGroupId: item.id,
        _modelGroupType: item.type,
      }));

      setGeneratedVariants(mergeWithExisting(variants));
      return;
    }

    // Build price map: value client id → { wholesale, retail }
    const priceMap = new Map<string, { wholesale: number; retail: number }>();
    for (const group of activeGroups) {
      for (const v of group.values) {
        if (v.label.trim() && v.wholesalePrice) {
          const wp = parseFloat(v.wholesalePrice);
          const rp = parseFloat(v.retailPrice) || wp;
          if (!isNaN(wp)) {
            priceMap.set(v.id, { wholesale: wp, retail: rp });
          }
        }
      }
    }

    const defaultWholesale = isUnified ? Number(product?.unified_wholesale_price ?? 0) : (parseFloat(defaultWholesalePrice) || 0);
    const defaultRetail = isUnified ? Number(product?.unified_retail_price ?? 0) : (parseFloat(defaultRetailPrice) || 0);

    // Build price resolution: try value prices in group order, fall back to default
    const resolvePrice = (valueIds: string[]): { wholesale: number; retail: number } => {
      for (const vid of valueIds) {
        if (priceMap.has(vid)) return priceMap.get(vid)!;
      }
      return { wholesale: defaultWholesale, retail: defaultRetail };
    };

    const getSkuPart = (v: OptionValueInput): string => v.value.trim() || v.label.trim();

    const valueLists = activeGroups.map(g =>
      g.values.filter(v => v.label.trim()),
    );

    const modelGroupItems = resolveDeviceItems();
    const modelDim = modelGroupItems.length > 0 ? modelGroupItems : [null];

    const codePrefix = product.code || 'PROD';
    let variantIndex = 0;
    const newVariants: GeneratedVariant[] = [];

    // Build name lookup for each value id
    const valueNameMap = new Map<string, string>();
    for (const g of activeGroups) {
      for (const v of g.values) {
        valueNameMap.set(v.id, v.label.trim());
      }
    }

    function cartesianProduct(
      lists: OptionValueInput[][],
      groupRefs: OptionGroupInput[],
      prefixValues: OptionValueInput[],
      depth: number,
    ): { values: OptionValueInput[] }[] {
      if (depth >= lists.length) return [{ values: prefixValues }];
      const result: { values: OptionValueInput[] }[] = [];
      for (const item of lists[depth]) {
        result.push(...cartesianProduct(lists, groupRefs, [...prefixValues, item], depth + 1));
      }
      return result;
    }

    const combinations = cartesianProduct(valueLists, activeGroups, [], 0);

    const barcodeLines = barcodeList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const combo of combinations) {
      for (const modelItem of modelDim) {
        const comboValues = combo.values;
        const valueIds = comboValues.map(v => v.id);

        const { wholesale: finalWholesale, retail: finalRetail } = isUnified
          ? { wholesale: Number(product?.unified_wholesale_price ?? 0), retail: Number(product?.unified_retail_price ?? 0) }
          : resolvePrice(valueIds);
        const nameLabels = comboValues.map(v => v.label.trim()).filter(Boolean);
        const skuParts = [codePrefix, ...comboValues.map(getSkuPart)];
        if (modelItem) skuParts.push(modelItem.name);
        const sku = skuParts.join('-').toUpperCase().replace(/\s+/g, '-');

        const variantName = modelItem
          ? `${product.name} - ${nameLabels.join(' / ')} (${modelItem.name})`
          : `${product.name}${nameLabels.length > 0 ? ' - ' + nameLabels.join(' / ') : ''}`;

        const barcode = variantIndex < barcodeLines.length ? barcodeLines[variantIndex] : '';

        newVariants.push({
          sku,
          name: variantName,
          barcode,
          wholesale_price: finalWholesale,
          retail_price: finalRetail,
          sort_order: variantIndex,
          optionValueIds: valueIds,
          _modelGroupId: modelItem?.id,
          _modelGroupType: modelItem?.type,
        });
        variantIndex++;
      }
    }

    if (newVariants.length === 0) {
      toast.error('無法生成變體，請檢查輸入');
      return;
    }

    setGeneratedVariants(mergeWithExisting(newVariants));
  };

  const identityKey = (v: GeneratedVariant): string => {
    const opts = [...v.optionValueIds].sort().join('|');
    return `${v._modelGroupId ?? ''}::${opts}`;
  };

  const mergeWithExisting = (newVariants: GeneratedVariant[]): GeneratedVariant[] => {
    const existingList = generatedVariants;
    const existingByKey = new Map(existingList.map(ev => [identityKey(ev), ev]));
    const newKeys = new Set(newVariants.map(identityKey));

    const removed = existingList.filter(ev => !newKeys.has(identityKey(ev)));
    let kept = 0;
    let priceUpdated = 0;

    const merged = newVariants.map(newV => {
      const key = identityKey(newV);
      const existing = existingByKey.get(key);
      if (existing) {
        kept++;
        if (existing.wholesale_price !== newV.wholesale_price || existing.retail_price !== newV.retail_price) {
          priceUpdated++;
        }
        return { ...newV, barcode: existing.barcode };
      }
      return newV;
    });

    setDiffSummary({
      added: merged.length - kept,
      kept,
      removed,
      priceUpdated,
    });
    return merged;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (generatedVariants.length === 0) throw new Error('請先生成變體');

      // 單一交易：所有 option groups / values / variant_options / variants /
      // entity_model_relations 的刪除與重建，交由 RPC 在一個 database
      // transaction 內完成，失敗自動 ROLLBACK，避免先刪後建造成的資料遺失。

      // 1. 群組與值（以客戶端臨時 id 為 ref，供建立時解析實際 UUID）
      const groupsPayload = optionGroups
        .filter(g => g.name.trim())
        .map(g => ({
          ref: g.id,
          name: g.name.trim(),
          values: g.values
            .filter(v => v.label.trim())
            .map(v => ({
              ref: v.id,
              label: v.label.trim(),
              value: v.value.trim() || v.label.trim(),
              hex_code: v.hexCode || null,
            })),
        }));

      // 2. 變體（依 SKU 去重）
      const variantsToInsert = generatedVariants.map(v => ({
        sku: v.sku,
        name: v.name,
        barcode: v.barcode || undefined,
        wholesale_price: v.wholesale_price,
        retail_price: v.retail_price,
        sort_order: v.sort_order,
      }));
      const dedupedVariants = [...new Map(variantsToInsert.map(v => [v.sku, v])).values()];

      // 3. 變體-選項連結（依 SKU + client ref 串接）
      const variantOptionsPayload: { sku: string; group_ref: string; value_ref: string }[] = [];
      const namedGroupIds = new Set(optionGroups.filter(g => g.name.trim()).map(g => g.id));
      for (const genVariant of generatedVariants) {
        for (const clientValueId of genVariant.optionValueIds) {
          const group = optionGroups.find(g => g.values.some(val => val.id === clientValueId));
          if (!group || !namedGroupIds.has(group.id)) continue;
          variantOptionsPayload.push({
            sku: genVariant.sku,
            group_ref: group.id,
            value_ref: clientValueId,
          });
        }
      }

      // 4. 型號關聯（依 SKU 串接，維持原租 per-variant / 全變體 兩種模式）
      const modelRelationsPayload: any[] = [];
      if (selectedDeviceRefs.length > 0) {
        const deviceOrder = new Map<string, number>();
        selectedDeviceRefs.forEach((ref, idx) => deviceOrder.set(ref.id, idx));

        const hasPerVariantMapping = generatedVariants.some(v => v._modelGroupId && v._modelGroupType);

        if (hasPerVariantMapping) {
          for (const genVariant of generatedVariants) {
            if (!genVariant._modelGroupId || !genVariant._modelGroupType) continue;
            modelRelationsPayload.push({
              sku: genVariant.sku,
              ...(genVariant._modelGroupType === 'model'
                ? { model_id: genVariant._modelGroupId }
                : { group_id: genVariant._modelGroupId }),
              sort_order: deviceOrder.get(genVariant._modelGroupId) ?? 0,
            });
          }
        } else {
          for (const genVariant of generatedVariants) {
            for (const ref of selectedDeviceRefs) {
              modelRelationsPayload.push({
                sku: genVariant.sku,
                ...(ref.type === 'model' ? { model_id: ref.id } : { group_id: ref.id }),
                sort_order: deviceOrder.get(ref.id) ?? 0,
              });
            }
          }
        }
      }
      console.log(
        'OPTION GROUP DETAIL JSON:',
        JSON.stringify(
          optionGroups.map(g => ({
            id: g.id,
            name: g.name,
            values: g.values.map(v => ({
              id: v.id,
              label: v.label,
              value: v.value,
              hexCode: v.hexCode,
            })),
          })),
          null,
          2
        )
      );

      console.log(
        'GROUP PAYLOAD JSON:',
        JSON.stringify(groupsPayload, null, 2)
      );

      console.log(
        'VARIANT OPTION JSON:',
        JSON.stringify(variantOptionsPayload[0], null, 2)
      );
      const { data, error } = await supabase.rpc('batch_upsert_product_options', {
        p_product_id: product.id,
        p_groups: groupsPayload,
        p_variants: dedupedVariants,
        p_variant_options: variantOptionsPayload,
        p_model_relations: modelRelationsPayload,
      });

      if (error) throw error;

      const result = data as unknown as { ok?: boolean; reason?: string } | null;
      if (result && result.ok === false) {
        throw new Error(result.reason || '批次更新失敗');
      }
    },
    onSuccess: () => {
      toast.success(`成功建立 ${generatedVariants.length} 個變體`);
      onSuccess();
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`建立失敗：${getErrorMessage(error)}`);
    },
  });

  const resetForm = () => {
    setOptionGroups([]);
    setSuggestions([]);
    setSelectedDeviceRefs([]);
    setDefaultWholesalePrice('');
    setDefaultRetailPrice('');
    setBarcodeList('');
    setGeneratedVariants([]);
    setDiffSummary(null);
    loadExistingDataDbValueToColorId.current = new Map();
  };

  const updateGroupName = (groupId: string, name: string) => {
    setOptionGroups(prev => prev.map(g => (g.id === groupId ? { ...g, name } : g)));
  };

  const removeGroup = (groupId: string) => {
    setOptionGroups(prev => prev.filter(g => g.id !== groupId));
  };

  const addGroup = () => {
    setOptionGroups(prev => [...prev, createOptionGroup()]);
  };

  const updateValue = (groupId: string, valueId: string, field: keyof OptionValueInput, value: string) => {
    setOptionGroups(prev =>
      prev.map(g =>
        g.id === groupId
          ? { ...g, values: g.values.map(v => (v.id === valueId ? { ...v, [field]: value } : v)) }
          : g,
      ),
    );
  };

  const removeValue = (groupId: string, valueId: string) => {
    setOptionGroups(prev =>
      prev.map(g =>
        g.id === groupId
          ? { ...g, values: g.values.filter(v => v.id !== valueId) }
          : g,
      ),
    );
  };

  const addValue = (groupId: string) => {
    setOptionGroups(prev =>
      prev.map(g =>
        g.id === groupId
          ? { ...g, values: [...g.values, createOptionValue()] }
          : g,
      ),
    );
  };

  const handleConfirmBulkPaste = () => {
    const rows = bulkPasteText
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const parts = s.split(':');
        const label = parts[0].trim();
        if (parts.length === 3) {
          const value = parts[1].trim();
          const prices = parts[2].split(/[,，]/).map(p => p.trim());
          return createOptionValue(label, value, prices[0] || '', prices[1] || '');
        }
        if (parts.length === 2) {
          const prices = parts[1].split(/[,，]/).map(p => p.trim());
          return createOptionValue(label, '', prices[0] || '', prices[1] || '');
        }
        return createOptionValue(label);
      });

    if (bulkPasteTargetGroupId) {
      setOptionGroups(prev =>
        prev.map(g =>
          g.id === bulkPasteTargetGroupId
            ? { ...g, values: [...g.values, ...rows] }
            : g,
        ),
      );
    }

    setBulkPasteTargetGroupId(null);
    setBulkPasteText('');
  };

  const updateVariantField = (index: number, field: keyof GeneratedVariant, value: string) => {
    setGeneratedVariants(prev =>
      prev.map((v, i) =>
        i === index
          ? { ...v, [field]: (field === 'wholesale_price' || field === 'retail_price') ? parseFloat(value) || 0 : value }
          : v,
      ),
    );
  };

  const removeVariant = (index: number) => {
    setGeneratedVariants(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            批次建立變體
          </DialogTitle>
          <DialogDescription>
            在下方定義選項群組與各選項值，可選填批發價／零售價，系統會自動生成所有排列組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Option Groups */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">選項群組</Label>
              <Button variant="outline" size="sm" onClick={addGroup}>
                <Plus className="h-4 w-4 mr-1" />新增群組
              </Button>
            </div>

            {!suggestionsLoading && suggestions.length > 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-muted-foreground">
                    分類建議（依此產品分類彙整自其他產品）
                  </Label>
                  <Button variant="outline" size="sm" onClick={importAllSuggestions}>
                    <Sparkles className="h-3.5 w-3.5 mr-1" />全部套用
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map(sug => {
                    const applied = optionGroups.some(
                      g => g.name.trim().toLowerCase() === sug.name.toLowerCase()
                    );
                    return (
                      <div
                        key={sug.name}
                        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-sm"
                      >
                        <span className="font-medium shrink-0">{sug.name}</span>
                        <span className="text-muted-foreground text-xs truncate max-w-[200px]">
                          {sug.values.map(v => v.label).join('、')}
                        </span>
                        {applied ? (
                          <Badge variant="secondary" className="text-xs shrink-0">已套用</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs shrink-0"
                            onClick={() => importSuggestion(sug)}
                          >
                            套用
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {optionGroups.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg">
                尚未建立任何選項群組，請點擊「新增群組」開始定義（例如：顏色、尺寸、規格...）
              </div>
            )}

            {optionGroups.map((group) => {
              const isColorGroup = isColorGroupName(group.name);
              const selectedColorIds = getGroupSelectedColorIds(group.values);
              const extraValues = group.values.filter(v => !findLibraryColor(libraryColors, v));

              return (
                <div key={group.id} className="border rounded-lg p-4 space-y-3 bg-card">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={group.name}
                      onChange={e => updateGroupName(group.id, e.target.value)}
                      className="h-8 max-w-[200px] font-medium"
                      placeholder="群組名稱（如：顏色、尺寸）"
                    />
                    {isColorGroup && (
                      <Badge variant="outline" className="text-xs text-muted-foreground">顏色群組</Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive ml-auto"
                      onClick={() => removeGroup(group.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <ColorSelectField
                    selectedColorIds={selectedColorIds}
                    onChange={(ids) => syncGroupColors(group.id, ids)}
                  />

                  {isColorGroup && extraValues.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {extraValues.map(v => (
                        <Badge
                          key={v.id}
                          variant="outline"
                          className="flex items-center gap-1 pr-1 pl-2 h-6"
                          style={{
                            backgroundColor: v.hexCode || 'transparent',
                            color: v.hexCode ? getContrastColor(v.hexCode) : 'inherit',
                          }}
                        >
                          {v.label || v.value}
                          <X
                            className="h-3 w-3 cursor-pointer hover:bg-black/10 rounded-full"
                            onClick={() => removeValue(group.id, v.id)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}

                  {!isColorGroup && (
                    <OptionValueTable
                      values={group.values}
                      onUpdate={(id, field, value) => updateValue(group.id, id, field, value)}
                      onRemove={(id) => removeValue(group.id, id)}
                      onAdd={() => addValue(group.id)}
                      onBulkPaste={() => { setBulkPasteText(''); setBulkPasteTargetGroupId(group.id); }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Device Models */}
          <div className="space-y-2">
            <Label>型號 / 群組（選填）</Label>
            <StandaloneDeviceModelSelectField
              selectionOrder={selectedDeviceRefs}
              onOrderChange={setSelectedDeviceRefs}
            />
          </div>

          {/* Barcode List */}
          <div className="space-y-2">
            <Label htmlFor="barcodeList">條碼列表（選填）</Label>
            <Textarea
              id="barcodeList"
              placeholder="依生成順序貼上條碼，每行一個。&#10;例如產生 6 個變體就貼 6 行，第 n 行對應第 n 個變體"
              value={barcodeList}
              onChange={(e) => setBarcodeList(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          {/* Bulk Paste Dialog */}
          <Dialog
            open={bulkPasteTargetGroupId !== null}
            onOpenChange={(open) => { if (!open) setBulkPasteTargetGroupId(null); }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>批量貼上</DialogTitle>
                <DialogDescription>
                  每行或逗號分隔一個值。支援格式：<code>名稱</code>、<code>名稱:批發價,零售價</code> 或 <code>名稱:SKU值:批發價,零售價</code>
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={bulkPasteText}
                onChange={e => setBulkPasteText(e.target.value)}
                placeholder={'例如：\n霧面:M:800,1200\n透明:T:900,1300\n抗藍光'}
                className="min-h-[200px]"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setBulkPasteTargetGroupId(null)}>取消</Button>
                <Button onClick={handleConfirmBulkPaste}>確認新增</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Default Prices */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultWholesale">預設批發價</Label>
              <Input
                id="defaultWholesale"
                type="number"
                step="0.01"
                disabled={isUnified}
                value={isUnified ? String(product?.unified_wholesale_price ?? 0) : defaultWholesalePrice}
                onChange={(e) => setDefaultWholesalePrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultRetail">預設零售價</Label>
              <Input
                id="defaultRetail"
                type="number"
                step="0.01"
                disabled={isUnified}
                value={isUnified ? String(product?.unified_retail_price ?? 0) : defaultRetailPrice}
                onChange={(e) => setDefaultRetailPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          {isUnified && (
            <p className="text-xs text-emerald-600">此產品為「統一價格」，生成變體將自動套用產品統一價，無需個別設定。</p>
          )}

          <Button onClick={generateVariants} className="w-full" variant="secondary">
            <Sparkles className="mr-2 h-4 w-4" />
            生成變體預覽
          </Button>

          {/* Preview */}
          {generatedVariants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">預覽（{generatedVariants.length} 個變體）</h4>
                <Badge variant="outline">點擊可編輯價格</Badge>
              </div>

              {diffSummary && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">新增 {diffSummary.added}</Badge>
                    <Badge variant="outline">保留 {diffSummary.kept}</Badge>
                    {diffSummary.removed.length > 0 && (
                      <Badge variant="destructive">移除 {diffSummary.removed.length}</Badge>
                    )}
                  </div>
                  {diffSummary.priceUpdated > 0 && (
                    <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                      <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>{diffSummary.priceUpdated} 個變體價格已依選項值／預設價格更新，原有手動修改已覆寫</span>
                    </div>
                  )}
                  {diffSummary.removed.length > 0 && (
                    <details className="border rounded-lg p-3 bg-destructive/5 border-destructive/20 text-sm">
                      <summary className="cursor-pointer text-destructive font-medium">
                        待移除清單（{diffSummary.removed.length}）— 僅提示，儲存時不會刪除既有變體
                      </summary>
                      <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {diffSummary.removed.map(rv => (
                          <li key={rv.sku} className="flex items-center gap-2 text-muted-foreground">
                            <X className="h-3 w-3 shrink-0" />
                            <span className="font-mono text-xs">{rv.sku}</span>
                            <span>{rv.name}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {selectedDeviceRefs.length > 0 && (
                <div className="flex items-center gap-2 p-2.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                  <Layers className="h-4 w-4 text-blue-600 shrink-0" />
                  <span>
                    {generatedVariants.some(v => v._modelGroupId && v._modelGroupType)
                      ? '變體將逐一關聯對應的型號/群組'
                      : `型號/群組將關聯至所有 ${generatedVariants.length} 個變體`}
                    ：
                    {resolveDeviceItems().map(item => item.name).join('、')}
                  </span>
                </div>
              )}

              <div className="border rounded-lg max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">變體名稱</th>
                      <th className="px-3 py-2 text-left">條碼 (Barcode)</th>
                      <th className="px-3 py-2 text-right w-24">批發價</th>
                      <th className="px-3 py-2 text-right w-24">零售價</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatedVariants.map((variant, index) => (
                      <tr key={index} className="border-t hover:bg-muted/50">
                        <td className="px-3 py-2">
                          <Input
                            value={variant.sku}
                            onChange={(e) => updateVariantField(index, 'sku', e.target.value)}
                            className="h-7 w-32 font-mono text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={variant.name}
                            onChange={(e) => updateVariantField(index, 'name', e.target.value)}
                            className="h-7 min-w-[120px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            placeholder="掃描或輸入條碼"
                            value={variant.barcode}
                            onChange={(e) => updateVariantField(index, 'barcode', e.target.value)}
                            className="h-7 w-32"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            disabled={isUnified}
                            value={variant.wholesale_price}
                            onChange={(e) => updateVariantField(index, 'wholesale_price', e.target.value)}
                            className="h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
                            disabled={isUnified}
                            value={variant.retail_price}
                            onChange={(e) => updateVariantField(index, 'retail_price', e.target.value)}
                            className="h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => removeVariant(index)}
                          >
                            ×
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <span>確認無誤後點擊下方按鈕建立變體，SKU 重複將會導致失敗</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>
              取消
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={generatedVariants.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? '建立中...' : `建立 ${generatedVariants.length} 個變體`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
