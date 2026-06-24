import { useEffect, useState } from 'react';
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
import { Layers, Sparkles, AlertCircle, Palette, X } from 'lucide-react';
import { ColorSelectField } from './ColorSelectField';
import { ColorManagementDialog } from './ColorManagementDialog';
import { useColorStore } from '@/store/useColorStore';
import { StandaloneDeviceModelSelectField } from '../StandaloneDeviceModelSelectField';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';

type Product = Tables<'products'>;

interface VariantBatchCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  onSuccess: () => void;
}

interface GeneratedVariant {
  sku: string;
  name: string;
  barcode: string;
  option_1: string | null;
  option_2: string | null;
  option_3: string | null;
  wholesale_price: number;
  retail_price: number;
  spec_values: any;
  /** 批次對話內部用，不進資料庫 */
  _modelGroupId?: string;
  _modelGroupType?: 'model' | 'group';
}

interface OptionValueRow {
  id: string;
  name: string;
  skuValue: string;
  wholesalePrice: string;
  retailPrice: string;
}

function createOptionRow(name = '', skuValue = '', wholesalePrice = '', retailPrice = ''): OptionValueRow {
  return { id: crypto.randomUUID(), name, skuValue, wholesalePrice, retailPrice };
}

interface OptionsTableProps {
  rows: OptionValueRow[];
  onUpdate: (id: string, field: keyof OptionValueRow, value: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onBulkPaste: () => void;
  placeholder: string;
}

function OptionsTable({ rows, onUpdate, onRemove, onAdd, onBulkPaste, placeholder }: OptionsTableProps) {
  return (
    <div className="space-y-2">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-1.5 text-left">名稱</th>
              <th className="px-3 py-1.5 text-left w-[100px]">SKU 值</th>
              <th className="px-3 py-1.5 text-right w-[100px]">批發價</th>
              <th className="px-3 py-1.5 text-right w-[100px]">零售價</th>
              <th className="px-3 py-1.5 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="border-t">
                <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground text-sm">
                  尚無選項值，請按下方按鈕新增，或使用批量貼上
                </td>
              </tr>
            ) : rows.map(row => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-1">
                  <Input
                    value={row.name}
                    onChange={e => onUpdate(row.id, 'name', e.target.value)}
                    className="h-8"
                    placeholder={placeholder}
                  />
                </td>
                <td className="px-3 py-1">
                  <Input
                    value={row.skuValue}
                    onChange={e => onUpdate(row.id, 'skuValue', e.target.value)}
                    className="h-8"
                    placeholder="留空=名稱"
                  />
                </td>
                <td className="px-3 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={row.wholesalePrice}
                    onChange={e => onUpdate(row.id, 'wholesalePrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-3 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    value={row.retailPrice}
                    onChange={e => onUpdate(row.id, 'retailPrice', e.target.value)}
                    className="h-8 text-right"
                    placeholder="選填"
                  />
                </td>
                <td className="px-3 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive"
                    onClick={() => onRemove(row.id)}
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
  const [option1Rows, setOption1Rows] = useState<OptionValueRow[]>([]);
  const [option2Rows, setOption2Rows] = useState<OptionValueRow[]>([]);
  const [bulkPasteTarget, setBulkPasteTarget] = useState<'option1' | 'option2' | null>(null);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [barcodeList, setBarcodeList] = useState('');
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [isColorManageOpen, setIsColorManageOpen] = useState(false);
  const [wholesalePrice, setWholesalePrice] = useState(product.base_wholesale_price.toString());
  const [retailPrice, setRetailPrice] = useState(product.base_retail_price.toString());
  const [generatedVariants, setGeneratedVariants] = useState<GeneratedVariant[]>([]);

  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const { colors, fetchColors } = useColorStore();
  const { models: deviceModels, groups: deviceGroups, fetchData: fetchDeviceData } = useDeviceModelStore();

  useEffect(() => {
    const init = async () => {
      if (open) {
        const [latestColors] = await Promise.all([
          fetchColors(),
          fetchDeviceData(),
        ]);
        await loadExistingVariants(latestColors);
      }
    };
    init();
  }, [open, fetchColors, fetchDeviceData]);

  const loadExistingVariants = async (currentColors = colors) => {
    try {
      const { data: variants, error } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', product.id);

      if (error) throw error;
      if (!variants || variants.length === 0) return;

      // 反解析輔助函式
      const groupVariants = (field: string) => {
        const map = new Map<string, typeof variants>();
        (variants as any[]).forEach((v: any) => {
          const val = v[field];
          if (val) {
            const group = map.get(val) || [];
            group.push(v);
            map.set(val, group);
          }
        });
        return map;
      };

      const getCommonPrice = (group: any[], getPrice: (v: any) => number): number | undefined => {
        if (group.length === 0) return undefined;
        const first = getPrice(group[0]);
        return group.every(v => getPrice(v) === first) ? first : undefined;
      };

      const extractSkuValue = (group: any[], precedingFields: string[]): string => {
        const v = group[0];
        if (!v?.sku) return '';
        let suffix: string = v.sku;
        if (suffix.startsWith(product.sku + '-')) {
          suffix = suffix.slice(product.sku.length + 1);
        } else {
          return '';
        }
        const segments = suffix.split('-');
        let offset = 0;
        for (const field of precedingFields) {
          if (v[field]) offset++;
        }
        return segments[offset] || '';
      };

      // 提取選項 1 的唯一值（反解析 SKU 值 & 價格）
      const opt1Groups = groupVariants('option_1');
      const parsedOpt1: OptionValueRow[] = [];
      for (const [name, group] of opt1Groups) {
        const wp = getCommonPrice(group, v => v.wholesale_price);
        const rp = getCommonPrice(group, v => v.retail_price);
        const skuVal = extractSkuValue(group, []);
        parsedOpt1.push(createOptionRow(name, skuVal, wp !== undefined ? wp.toString() : '', rp !== undefined ? rp.toString() : ''));
      }
      setOption1Rows(parsedOpt1);

      // 提取選項 2 的唯一值（反解析 SKU 值 & 價格）
      const opt2Groups = groupVariants('option_2');
      const parsedOpt2: OptionValueRow[] = [];
      for (const [name, group] of opt2Groups) {
        const wp = getCommonPrice(group, v => v.wholesale_price);
        const rp = getCommonPrice(group, v => v.retail_price);
        const skuVal = extractSkuValue(group, ['option_1']);
        parsedOpt2.push(createOptionRow(name, skuVal, wp !== undefined ? wp.toString() : '', rp !== undefined ? rp.toString() : ''));
      }
      setOption2Rows(parsedOpt2);

      // 提取顏色的唯一 ID (透過名稱匹配)
      const colorNames = new Set(variants.map(v => v.option_3).filter(Boolean));
      const colorIds = Array.from(colorNames)
        .map(name => currentColors.find(c => c.name === name)?.id)
        .filter(Boolean) as string[];
      setSelectedColorIds(colorIds);

      // 載入既有 entity_model_relations 取得已關聯的型號/群組
      const variantIds = variants.map(v => v.id);
      const { data: relations } = await supabase
        .from('entity_model_relations')
        .select('variant_id, model_id, group_id')
        .in('variant_id', variantIds)
        .eq('relation_type', 'include');

      const modelIdSet = new Set<string>();
      const groupIdSet = new Set<string>();
      const variantModelMap = new Map<string, { id: string; type: 'model' | 'group' }[]>();
      relations?.forEach(r => {
        if (r.model_id) {
          modelIdSet.add(r.model_id);
          if (r.variant_id) {
            const list = variantModelMap.get(r.variant_id) || [];
            list.push({ id: r.model_id, type: 'model' });
            variantModelMap.set(r.variant_id, list);
          }
        }
        if (r.group_id) {
          groupIdSet.add(r.group_id);
          if (r.variant_id) {
            const list = variantModelMap.get(r.variant_id) || [];
            list.push({ id: r.group_id, type: 'group' });
            variantModelMap.set(r.variant_id, list);
          }
        }
      });
      setSelectedModelIds(Array.from(modelIdSet));
      setSelectedGroupIds(Array.from(groupIdSet));

      // 判斷是否為逐一關聯（每個變體剛好一個關聯）
      const isPerVariant = relations && relations.length > 0 &&
        relations.length === variantIds.length &&
        Array.from(variantModelMap.values()).every(list => list.length === 1);

      // 填入預覽表格（含型號/群組對應）
      setGeneratedVariants(variants.map(v => {
        const mappings = variantModelMap.get(v.id);
        const singleMapping = isPerVariant && mappings?.length === 1 ? mappings[0] : undefined;
        return {
          sku: v.sku,
          name: v.name,
          barcode: v.barcode || '',
          option_1: v.option_1,
          option_2: v.option_2,
          option_3: v.option_3,
          wholesale_price: v.wholesale_price,
          retail_price: v.retail_price,
          spec_values: (v as any).spec_values || {},
          _modelGroupId: singleMapping?.id,
          _modelGroupType: singleMapping?.type,
        };
      }));

      toast.success(`已載入 ${variants.length} 個現有變體`);
    } catch (err) {
      console.error('載入變體失敗:', err);
    }
  };

  const generateVariants = () => {
    const opt1 = option1Rows.filter(r => r.name.trim()).map(r => r.name.trim());
    const opt2 = option2Rows.filter(r => r.name.trim()).map(r => r.name.trim());

    const selectedColors = selectedColorIds
      .map(id => colors.find(c => c.id === id))
      .filter(Boolean);

    const hasOptions = opt1.length > 0 || opt2.length > 0 || selectedColors.length > 0;
    const hasModelsOrGroups = selectedModelIds.length > 0 || selectedGroupIds.length > 0;

    const defaultPrice = parseFloat(wholesalePrice) || product.base_wholesale_price;
    const defaultRetail = parseFloat(retailPrice) || product.base_retail_price;

    // 建立各維度價格查詢表（值名稱 → { wholesale, retail }）
    const buildPriceMap = (rows: OptionValueRow[]) => {
      const map = new Map<string, { wholesale: number; retail: number }>();
      rows.forEach(r => {
        const name = r.name.trim();
        if (name && r.wholesalePrice) {
          const wp = parseFloat(r.wholesalePrice);
          const rp = parseFloat(r.retailPrice) || wp;
          if (!isNaN(wp)) map.set(name, { wholesale: wp, retail: rp });
        }
      });
      return map;
    };
    const opt1PriceMap = buildPriceMap(option1Rows);
    const opt2PriceMap = buildPriceMap(option2Rows);

    // 依維度優先順序決定價格：選項1 → 選項2 → 預設
    const resolvePrice = (v1: string | null, v2: string | null): { wholesale: number; retail: number } => {
      if (v1 && opt1PriceMap.has(v1)) return opt1PriceMap.get(v1)!;
      if (v2 && opt2PriceMap.has(v2)) return opt2PriceMap.get(v2)!;
      return { wholesale: defaultPrice, retail: defaultRetail };
    };

    // 取得選項值在 SKU 中使用的代碼（若無 skuValue 則回退到名稱）
    const getSkuPart = (rows: OptionValueRow[], name: string): string => {
      const row = rows.find(r => r.name.trim() === name);
      return row?.skuValue?.trim() || name;
    };

    // 解析條碼列表（按行）
    const barcodeLines = barcodeList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let variants: GeneratedVariant[];

    if (!hasOptions && hasModelsOrGroups) {
      // 純型號/群組生成路徑：每個型號/群組一個變體，option 全為 null
      const modelGroupNames: { name: string; id: string; type: 'model' | 'group' }[] = [
        ...selectedModelIds.map(id => {
          const m = deviceModels.find(m => m.id === id);
          return m ? { name: m.name, id: m.id, type: 'model' as const } : null;
        }).filter(Boolean),
        ...selectedGroupIds.map(id => {
          const g = deviceGroups.find(g => g.id === id);
          return g ? { name: g.name, id: g.id, type: 'group' as const } : null;
        }).filter(Boolean),
      ];

      variants = modelGroupNames.map((item, idx) => ({
        sku: `${product.sku}-${item.name}`.toUpperCase().replace(/\s+/g, '-'),
        name: `${product.name} - ${item.name}`,
        barcode: barcodeLines[idx] || '',
        option_1: null,
        option_2: null,
        option_3: null,
        wholesale_price: defaultPrice,
        retail_price: defaultRetail,
        spec_values: {},
        _modelGroupId: item.id,
        _modelGroupType: item.type,
      }));
    } else {
      if (!hasOptions) {
        toast.error('請至少輸入或選擇一個選項維度 (選項1、選項2 或 顏色)');
        return;
      }

      variants = [];

      // 準備三個維度的資料
      const dim1 = opt1.length > 0 ? opt1 : [null];
      const dim2 = opt2.length > 0 ? opt2 : [null];
      const dim3 = selectedColors.length > 0 ? selectedColors : [null];

      // 準備型號/群組維度（交叉生成）
      const modelGroupItems: { name: string; id: string; type: 'model' | 'group' }[] = [
        ...selectedModelIds.map(id => {
          const m = deviceModels.find(m => m.id === id);
          return m ? { name: m.name, id: m.id, type: 'model' as const } : null;
        }).filter(Boolean),
        ...selectedGroupIds.map(id => {
          const g = deviceGroups.find(g => g.id === id);
          return g ? { name: g.name, id: g.id, type: 'group' as const } : null;
        }).filter(Boolean),
      ];
      const dim4 = modelGroupItems.length > 0 ? modelGroupItems : [null];

      // 生成所有維度的組合
      let variantIndex = 0;
      for (const v1 of dim1) {
        for (const v2 of dim2) {
          for (const v3 of dim3) {
            for (const v4 of dim4) {
              if (!v1 && !v2 && !v3 && !v4) continue;

              const { wholesale: finalWholesale, retail: finalRetail } = resolvePrice(v1, v2);

              const skuParts = [product.sku];
              if (v1) skuParts.push(getSkuPart(option1Rows, v1));
              if (v2) skuParts.push(getSkuPart(option2Rows, v2));
              if (v3) skuParts.push((v3 as any).code || (v3 as any).name);
              if (v4) skuParts.push(v4.name);
              const sku = skuParts.join('-').toUpperCase().replace(/\s+/g, '-');

              const nameParts = [];
              if (v1) nameParts.push(v1);
              if (v2) nameParts.push(v2);
              if (v3) nameParts.push((v3 as any).name);
              if (v4) nameParts.push(v4.name);
              const variantName = `${product.name}${nameParts.length > 0 ? ' - ' + nameParts.join(' / ') : ''}`;

              const barcode = variantIndex < barcodeLines.length ? barcodeLines[variantIndex] : '';

              variants.push({
                sku,
                name: variantName,
                barcode,
                option_1: v1,
                option_2: v2,
                option_3: v3 ? (v3 as any).name : null,
                wholesale_price: finalWholesale,
                retail_price: finalRetail,
                spec_values: {},
                _modelGroupId: v4?.id,
                _modelGroupType: v4?.type,
              });
              variantIndex++;
            }
          }
        }
      }
    }

    if (variants.length === 0) {
      toast.error('無法生成變體，請檢查輸入');
      return;
    }

    // 智慧合併：保留既有的手動編輯（價格、條碼），內部追蹤欄位以新值為準
    const mergedVariants = variants.map(newV => {
      const existing = generatedVariants.find(ev => ev.sku === newV.sku);
      if (existing) {
        return { ...existing, _modelGroupId: newV._modelGroupId, _modelGroupType: newV._modelGroupType };
      }
      return newV;
    });

    setGeneratedVariants(mergedVariants);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (generatedVariants.length === 0) throw new Error('請先生成變體');

      const variantsToInsert = generatedVariants.map(v => ({
        product_id: product.id,
        sku: v.sku,
        name: v.name,
        barcode: v.barcode || null,
        option_1: v.option_1 || null,
        option_2: v.option_2 || null,
        option_3: v.option_3 || null,
        wholesale_price: v.wholesale_price,
        retail_price: v.retail_price,
        status: 'active' as const,
      }));

      // 1. Upsert 變體並取回 ID
      const { data: upsertedVariants, error } = await supabase
        .from('product_variants')
        .upsert(variantsToInsert, { onConflict: 'sku' })
        .select('id, sku');

      if (error) throw error;
      if (!upsertedVariants || upsertedVariants.length === 0) return;

      // 2. 建立 SKU → ID 映射
      const skuToId = new Map(upsertedVariants.map(v => [v.sku, v.id]));
      const upsertedIds = upsertedVariants.map(v => v.id);

      // 3. 刪除此批變體的現有 model relations (include)
      const { error: delErr } = await supabase
        .from('entity_model_relations')
        .delete()
        .in('variant_id', upsertedIds)
        .eq('relation_type', 'include');
      if (delErr) throw delErr;

      // 4. 批次關聯型號/群組
      if (selectedModelIds.length > 0 || selectedGroupIds.length > 0) {
        const relations: any[] = [];
        const hasPerVariantMapping = generatedVariants.some(v => v._modelGroupId && v._modelGroupType);

        if (hasPerVariantMapping) {
          // 逐一關聯：每個變體只關聯對應的型號或群組
          upsertedVariants.forEach(({ id, sku }) => {
            const v = generatedVariants.find(v => v.sku === sku);
            if (!v?._modelGroupId || !v._modelGroupType) return;
            if (v._modelGroupType === 'model') {
              relations.push({ variant_id: id, model_id: v._modelGroupId, relation_type: 'include' });
            } else {
              relations.push({ variant_id: id, group_id: v._modelGroupId, relation_type: 'include' });
            }
          });
        } else {
          // 共用關聯：所有型號/群組關聯到所有變體
          upsertedIds.forEach(vId => {
            selectedModelIds.forEach(mId => relations.push({ variant_id: vId, model_id: mId, relation_type: 'include' }));
            selectedGroupIds.forEach(gId => relations.push({ variant_id: vId, group_id: gId, relation_type: 'include' }));
          });
        }

        const { error: relErr } = await supabase.from('entity_model_relations').insert(relations);
        if (relErr) throw relErr;
      }

      // 5. 同步前台展示
      const { error: syncErr } = await supabase.rpc('sync_storefront_items', { p_product_id: product.id });
      if (syncErr) throw syncErr;
    },
    onSuccess: () => {
      toast.success(`成功建立 ${generatedVariants.length} 個變體`);
      onSuccess();
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`建立失敗：${error.message}`);
    },
  });

  const resetForm = () => {
    setOption1Rows([]);
    setOption2Rows([]);
    setSelectedColorIds([]);
    setSelectedModelIds([]);
    setSelectedGroupIds([]);
    setWholesalePrice(product.base_wholesale_price.toString());
    setRetailPrice(product.base_retail_price.toString());
    setBarcodeList('');
    setGeneratedVariants([]);
  };

  const updateOptionRow = (
    setter: React.Dispatch<React.SetStateAction<OptionValueRow[]>>,
    id: string,
    field: keyof OptionValueRow,
    value: string,
  ) => {
    setter(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const removeOptionRow = (
    setter: React.Dispatch<React.SetStateAction<OptionValueRow[]>>,
    id: string,
  ) => {
    setter(prev => prev.filter(r => r.id !== id));
  };

  const handleConfirmBulkPaste = () => {
    const rows = bulkPasteText
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const parts = s.split(':');
        const name = parts[0].trim();
        if (parts.length === 3) {
          // 名稱:SKU值:批發價,零售價
          const skuValue = parts[1].trim();
          const prices = parts[2].split(/[,，]/).map(p => p.trim());
          return createOptionRow(name, skuValue, prices[0] || '', prices[1] || '');
        }
        if (parts.length === 2) {
          // 名稱:批發價,零售價
          const prices = parts[1].split(/[,，]/).map(p => p.trim());
          return createOptionRow(name, '', prices[0] || '', prices[1] || '');
        }
        return createOptionRow(name);
      });

    if (bulkPasteTarget === 'option1') {
      setOption1Rows(prev => [...prev, ...rows]);
    } else if (bulkPasteTarget === 'option2') {
      setOption2Rows(prev => [...prev, ...rows]);
    }

    setBulkPasteTarget(null);
    setBulkPasteText('');
  };

  const updateVariantField = (index: number, field: keyof GeneratedVariant, value: string) => {
    setGeneratedVariants(prev =>
      prev.map((v, i) =>
        i === index ? { ...v, [field]: (field === 'wholesale_price' || field === 'retail_price') ? parseFloat(value) || 0 : value } : v
      )
    );
  };

  const removeVariant = (index: number) => {
    setGeneratedVariants(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            批次建立變體
          </DialogTitle>
          <DialogDescription>
             在下方表格輸入各選項值，可選填批發價／零售價（也可後續在預覽表格編輯），系統會自動生成排列組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 選項輸入 */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>選項1（必填）</Label>
              <OptionsTable
                rows={option1Rows}
                onUpdate={(id, field, value) => updateOptionRow(setOption1Rows, id, field, value)}
                onRemove={(id) => removeOptionRow(setOption1Rows, id)}
                onAdd={() => setOption1Rows(prev => [...prev, createOptionRow()])}
                onBulkPaste={() => { setBulkPasteText(''); setBulkPasteTarget('option1'); }}
                placeholder="輸入選項值"
              />
            </div>
            <div className="space-y-2">
              <Label>選項2（選填）</Label>
              <OptionsTable
                rows={option2Rows}
                onUpdate={(id, field, value) => updateOptionRow(setOption2Rows, id, field, value)}
                onRemove={(id) => removeOptionRow(setOption2Rows, id)}
                onAdd={() => setOption2Rows(prev => [...prev, createOptionRow()])}
                onBulkPaste={() => { setBulkPasteText(''); setBulkPasteTarget('option2'); }}
                placeholder="輸入選項值"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>顏色</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setIsColorManageOpen(true)}
                  >
                    <Palette className="h-3 w-3 mr-1" /> 管理顏色
                  </Button>
                </div>
                <ColorSelectField
                  selectedColorIds={selectedColorIds}
                  onChange={setSelectedColorIds}
                />
              </div>
              <div className="space-y-2">
                <Label>型號 / 群組（選填）</Label>
                <StandaloneDeviceModelSelectField
                  modelIds={selectedModelIds}
                  groupIds={selectedGroupIds}
                  onChange={({ modelIds, groupIds }) => {
                    setSelectedModelIds(modelIds);
                    setSelectedGroupIds(groupIds);
                  }}
                />
              </div>
            </div>
          </div>

          {/* 條碼列表 */}
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

          <ColorManagementDialog
            open={isColorManageOpen}
            onOpenChange={setIsColorManageOpen}
          />

          {/* 批量貼上對話框 */}
          <Dialog open={bulkPasteTarget !== null} onOpenChange={(open) => { if (!open) setBulkPasteTarget(null); }}>
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
                <Button variant="outline" onClick={() => setBulkPasteTarget(null)}>取消</Button>
                <Button onClick={handleConfirmBulkPaste}>確認新增</Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* 預設價格 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="defaultWholesale">預設批發價</Label>
              <Input
                id="defaultWholesale"
                type="number"
                step="0.01"
                value={wholesalePrice}
                onChange={(e) => setWholesalePrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultRetail">預設零售價</Label>
              <Input
                id="defaultRetail"
                type="number"
                step="0.01"
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
              />
            </div>
          </div>

          <Button onClick={generateVariants} className="w-full" variant="secondary">
            <Sparkles className="mr-2 h-4 w-4" />
            生成變體預覽
          </Button>

          {/* 預覽結果 */}
          {generatedVariants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">預覽（{generatedVariants.length} 個變體）</h4>
                <Badge variant="outline">點擊可編輯價格</Badge>
              </div>

              {/* 型號/群組關聯提示 */}
              {(selectedModelIds.length > 0 || selectedGroupIds.length > 0) && (
                <div className="flex items-center gap-2 p-2.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm">
                  <Layers className="h-4 w-4 text-blue-600 shrink-0" />
                  <span>
                    {generatedVariants.some(v => v._modelGroupId && v._modelGroupType)
                      ? '變體將逐一關聯對應的型號/群組'
                      : `型號/群組將關聯至所有 ${generatedVariants.length} 個變體`}
                    ：
                    {[
                      ...selectedModelIds.map(id => deviceModels.find(m => m.id === id)?.name).filter(Boolean),
                      ...selectedGroupIds.map(id => deviceGroups.find(g => g.id === id)?.name).filter(Boolean),
                    ].join('、')}
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
                            value={variant.wholesale_price}
                            onChange={(e) => updateVariantField(index, 'wholesale_price', e.target.value)}
                            className="h-7 w-20 text-right"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="0.01"
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

          {/* 操作按鈕 */}
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
