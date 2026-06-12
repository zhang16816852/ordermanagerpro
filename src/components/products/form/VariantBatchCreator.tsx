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
}

export function VariantBatchCreator({ open, onOpenChange, product, onSuccess }: VariantBatchCreatorProps) {
  const [option1Values, setOption1Values] = useState('');
  const [option2Values, setOption2Values] = useState('');
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

      // 提取選項 1 的唯一值
      const opt1Set = new Set(variants.map(v => v.option_1).filter(Boolean));
      setOption1Values(Array.from(opt1Set).join('\n'));

      // 提取選項 2 的唯一值
      const opt2Set = new Set(variants.map(v => v.option_2).filter(Boolean));
      setOption2Values(Array.from(opt2Set).join('\n'));

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
        .select('model_id, group_id')
        .in('variant_id', variantIds)
        .eq('relation_type', 'include');

      const modelIdSet = new Set<string>();
      const groupIdSet = new Set<string>();
      relations?.forEach(r => {
        if (r.model_id) modelIdSet.add(r.model_id);
        if (r.group_id) groupIdSet.add(r.group_id);
      });
      setSelectedModelIds(Array.from(modelIdSet));
      setSelectedGroupIds(Array.from(groupIdSet));

      // 填入預覽表格
      setGeneratedVariants(variants.map(v => ({
        sku: v.sku,
        name: v.name,
        barcode: v.barcode || '',
        option_1: v.option_1,
        option_2: v.option_2,
        option_3: v.option_3,
        wholesale_price: v.wholesale_price,
        retail_price: v.retail_price,
        spec_values: (v as any).spec_values || {},
      })));

      toast.success(`已載入 ${variants.length} 個現有變體`);
    } catch (err) {
      console.error('載入變體失敗:', err);
    }
  };

  const parseOptions = (text: string): string[] => {
    return text
      .split(/[,，\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const generateVariants = () => {
    const opt1 = parseOptions(option1Values);
    const opt2 = parseOptions(option2Values);

    const selectedColors = selectedColorIds
      .map(id => colors.find(c => c.id === id))
      .filter(Boolean);

    if (opt1.length === 0 && opt2.length === 0 && selectedColors.length === 0) {
      toast.error('請至少輸入或選擇一個選項維度 (選項1、選項2 或 顏色)');
      return;
    }

    const variants: GeneratedVariant[] = [];
    const price = parseFloat(wholesalePrice) || product.base_wholesale_price;
    const retail = parseFloat(retailPrice) || product.base_retail_price;

    // 準備三個維度的資料 (型號/群組不參與笛卡爾積，於儲存時批次關聯)
    const dim1 = opt1.length > 0 ? opt1 : [null];
    const dim2 = opt2.length > 0 ? opt2 : [null];
    const dim3 = selectedColors.length > 0 ? selectedColors : [null];

    // 生成所有維度的組合
    for (const v1 of dim1) {
      for (const v2 of dim2) {
        for (const v3 of dim3) {
          if (!v1 && !v2 && !v3) continue;

          // 構建 SKU
          const skuParts = [product.sku];
          if (v1) skuParts.push(v1);
          if (v2) skuParts.push(v2);
          if (v3) skuParts.push((v3 as any).code || (v3 as any).name);
          const sku = skuParts.join('-').toUpperCase().replace(/\s+/g, '-');

          // 構建名稱
          const nameParts = [];
          if (v1) nameParts.push(v1);
          if (v2) nameParts.push(v2);
          if (v3) nameParts.push((v3 as any).name);
          const variantName = `${product.name}${nameParts.length > 0 ? ' - ' + nameParts.join(' / ') : ''}`;

          variants.push({
            sku,
            name: variantName,
            barcode: '',
            option_1: v1,
            option_2: v2,
            option_3: v3 ? (v3 as any).name : null,
            wholesale_price: price,
            retail_price: retail,
            spec_values: {},
          });
        }
      }
    }

    if (variants.length === 0) {
      toast.error('無法生成變體，請檢查輸入');
      return;
    }

    // 智慧合併：保留既有變體的手動編輯資料
    const mergedVariants = variants.map(newV => {
      const existing = generatedVariants.find(ev => ev.sku === newV.sku);
      if (existing) {
        return { ...existing };
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

      // 4. 批次關聯型號/群組到所有變體
      if (selectedModelIds.length > 0 || selectedGroupIds.length > 0) {
        const relations: any[] = [];
        upsertedIds.forEach(vId => {
          selectedModelIds.forEach(mId => relations.push({ variant_id: vId, model_id: mId, relation_type: 'include' }));
          selectedGroupIds.forEach(gId => relations.push({ variant_id: vId, group_id: gId, relation_type: 'include' }));
        });
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
    setOption1Values('');
    setOption2Values('');
    setSelectedColorIds([]);
    setSelectedModelIds([]);
    setSelectedGroupIds([]);
    setWholesalePrice(product.base_wholesale_price.toString());
    setRetailPrice(product.base_retail_price.toString());
    setGeneratedVariants([]);
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
            為「{product.name}」批次建立變體，輸入各選項的值（用逗號或換行分隔），系統會自動生成排列組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* 選項輸入 */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="option1">選項1（必填）</Label>
              <Textarea
                id="option1"
                placeholder="輸入選項值，例如：&#10;霧面&#10;透明&#10;抗藍光"
                value={option1Values}
                onChange={(e) => setOption1Values(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="option2">選項2（選填）</Label>
              <Textarea
                id="option2"
                placeholder="輸入選項值，例如：&#10;128GB&#10;256GB&#10;512GB"
                value={option2Values}
                onChange={(e) => setOption2Values(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
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

          <ColorManagementDialog
            open={isColorManageOpen}
            onOpenChange={setIsColorManageOpen}
          />

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
                    型號/群組將關聯至所有 {generatedVariants.length} 個變體：
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
