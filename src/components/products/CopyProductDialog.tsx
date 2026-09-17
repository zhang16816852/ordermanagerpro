import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import { Copy, Sparkles, AlertCircle } from 'lucide-react';
import { StandaloneDeviceModelSelectField, type DeviceSelectionRef } from '@/components/products/StandaloneDeviceModelSelectField';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { VariantOptionsEditor } from '@/components/products/variant/VariantOptionsEditor';
import { VariantPreviewTable } from '@/components/products/variant/VariantPreviewTable';
import {
  type OptionGroupInput,
  type SharedVariant,
  type VariantEditableField,
  getActiveGroups,
  buildPriceMap,
  generateVariantCombos,
  buildVariantPayload,
  buildGroupsPayload,
  buildDedupedVariantsPayload,
  buildVariantOptionsPayload,
  buildModelRelationsPayload,
  estimateComboCount,
} from '@/utils/variantGeneration';

type Product = Tables<'products'>;

interface CopyProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onCopied: (newProductId: string) => void;
}

export function CopyProductDialog({ open, onOpenChange, product, onCopied }: CopyProductDialogProps) {
  const [activeTab, setActiveTab] = useState('basic');
  const [newName, setNewName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [selectedDeviceRefs, setSelectedDeviceRefs] = useState<DeviceSelectionRef[]>([]);
  const [optionGroups, setOptionGroups] = useState<OptionGroupInput[]>([]);
  const [originalVariantCount, setOriginalVariantCount] = useState(0);
  const [baseWholesale, setBaseWholesale] = useState(0);
  const [baseRetail, setBaseRetail] = useState(0);
  const [generatedVariants, setGeneratedVariants] = useState<SharedVariant[]>([]);
  const [generatedSignature, setGeneratedSignature] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const originalGroupsRef = useRef<{ name: string; values: { label: string; value: string; wholesalePrice: string; retailPrice: string }[] }[]>([]);
  const originalDeviceRefsRef = useRef<DeviceSelectionRef[]>([]);

  const { models: deviceModels, groups: deviceGroups, fetchData: fetchDeviceData } = useDeviceModelStore();

  const loadOriginalData = useCallback(async () => {
    if (!product) return;
    setLoadingOptions(true);
    try {
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, wholesale_price, retail_price')
        .eq('product_id', product.id)
        .order('sort_order', { ascending: true });
      setOriginalVariantCount(variants?.length || 0);
      if (variants && variants.length > 0) {
        setBaseWholesale(variants[0]?.wholesale_price || 0);
        setBaseRetail(variants[0]?.retail_price || 0);
      }

      const { data: groups } = await supabase
        .from('product_option_groups')
        .select('*, product_option_values(*)')
        .eq('product_id', product.id)
        .order('sort_order', { ascending: true });

      if (groups && groups.length > 0) {
        const loaded: OptionGroupInput[] = groups.map(g => ({
          id: g.id,
          name: g.name,
          values: (g.product_option_values || [])
            .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
            .map((v: any) => ({
              id: v.id,
              label: v.label,
              value: v.value || '',
              wholesalePrice: '',
              retailPrice: '',
              hexCode: v.hex_code || '',
            })),
        }));
        setOptionGroups(loaded);
        originalGroupsRef.current = loaded.map(g => ({
          name: g.name,
          values: g.values.map(v => ({ label: v.label, value: v.value, wholesalePrice: '', retailPrice: '' })),
        }));
      } else {
        setOptionGroups([]);
        originalGroupsRef.current = [];
      }

      const { data: relations } = await supabase
        .from('entity_model_relations')
        .select('model_id, group_id')
        .in('variant_id', variants?.map(v => v.id) || [])
        .eq('relation_type', 'include');

      if (relations && relations.length > 0) {
        const seen = new Set<string>();
        const refs: DeviceSelectionRef[] = [];
        for (const r of relations) {
          if (r.model_id && !seen.has(`model:${r.model_id}`)) {
            seen.add(`model:${r.model_id}`);
            refs.push({ id: r.model_id, type: 'model' });
          }
          if (r.group_id && !seen.has(`group:${r.group_id}`)) {
            seen.add(`group:${r.group_id}`);
            refs.push({ id: r.group_id, type: 'group' });
          }
        }
        setSelectedDeviceRefs(refs);
        originalDeviceRefsRef.current = refs;
      } else {
        originalDeviceRefsRef.current = [];
      }
    } catch (err) {
      console.error('載入原始資料失敗:', err);
    } finally {
      setLoadingOptions(false);
    }
  }, [product]);

  useEffect(() => {
    if (open && product) {
      setNewName(`${product.name} (複製)`);
      setSkuPrefix(`${product.code || 'PROD'}-COPY`);
      setSelectedDeviceRefs([]);
      setActiveTab('basic');
      setSaving(false);
      setGeneratedVariants([]);
      setGeneratedSignature('');
      loadOriginalData();
      fetchDeviceData();
    }
  }, [open, product, fetchDeviceData, loadOriginalData]);

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

  const currentSignature = () => {
    const groups = getActiveGroups(optionGroups).map(g => ({
      name: g.name.trim(),
      values: g.values
        .filter(v => v.label.trim())
        .map(v => ({
          label: v.label.trim(),
          value: v.value.trim() || v.label.trim(),
          wholesalePrice: v.wholesalePrice,
          retailPrice: v.retailPrice,
        })),
    }));
    return JSON.stringify({
      prefix: (skuPrefix || `${product?.code || 'PROD'}-COPY`).trim(),
      groups,
      refs: selectedDeviceRefs.map(r => `${r.type}:${r.id}`).join('|'),
    });
  };

  // 依目前「選項群組 × 型號群組 × SKU 前綴」產生變體清單（純運算，不做限制）
  const buildVariants = (): SharedVariant[] => {
    const codePrefix = (skuPrefix || `${product?.code || 'PROD'}-COPY`).trim();
    const baseName = newName || product?.name || '';
    const priceMap = buildPriceMap(optionGroups);
    const defaults = { wholesale: baseWholesale, retail: baseRetail };
    const combos = generateVariantCombos({
      optionGroups,
      modelItems: resolveDeviceItems(),
      prefix: codePrefix,
      baseName,
      priceMap,
      defaults,
      unified: null,
    });
    return buildVariantPayload({
      combos,
      prefix: codePrefix,
      baseName,
      priceMap,
      defaults,
      unified: null,
    });
  };

  const generatePreview = () => {
    const unnamedGroups = optionGroups.filter(g => !g.name.trim() && g.values.some(v => v.label.trim()));
    if (unnamedGroups.length > 0) {
      toast.error(`有 ${unnamedGroups.length} 個選項群組未填寫名稱，請補填名稱後再生成`);
      return;
    }
    const variants = buildVariants();
    if (variants.length === 0) {
      toast.error('請至少建立一個選項群組並輸入值，或選擇型號/群組');
      return;
    }
    setGeneratedVariants(variants);
    setGeneratedSignature(currentSignature());
    setActiveTab('preview');
  };

  const updateVariantField = (index: number, field: VariantEditableField, value: string) => {
    setGeneratedVariants(prev =>
      prev.map((v, i) =>
        i === index
          ? { ...v, [field]: (field === 'wholesale_price' || field === 'retail_price') ? (parseFloat(value) || 0) : value }
          : v,
      ),
    );
  };

  const removeVariantItem = (index: number) => {
    setGeneratedVariants(prev => prev.filter((_, i) => i !== index));
  };

  const handleCopy = async () => {
    if (!product) return;
    setSaving(true);

    try {
      const { data: newProductId, error: copyError } = await (supabase.rpc as any)('duplicate_product_with_variants', {
        target_product_id: product.id,
        new_name: newName || `${product.name} (複製)`,
        new_sku: skuPrefix || `${product.code || 'PROD'}-COPY`,
      });
      if (copyError) throw copyError;
      if (!newProductId) throw new Error('複製失敗：未回傳新產品 ID');

      const groupsList = getActiveGroups(optionGroups);
      const currentGroupSnapshot = groupsList.map(g => ({
        name: g.name.trim(),
        values: g.values
          .filter(v => v.label.trim())
          .map(v => ({
            label: v.label.trim(),
            value: v.value.trim() || v.label.trim(),
            wholesalePrice: v.wholesalePrice,
            retailPrice: v.retailPrice,
          })),
      }));
      const optionsChanged = JSON.stringify(currentGroupSnapshot) !== JSON.stringify(originalGroupsRef.current);

      const currentRefKey = (refs: DeviceSelectionRef[]) => refs.map(r => `${r.type}:${r.id}`).join('|');
      const modelsChanged = currentRefKey(selectedDeviceRefs) !== currentRefKey(originalDeviceRefsRef.current);

      // 決定要重新生成的變體清單：
      // 1) 使用者已在「變體預覽」生成且選項/型號/前綴未再變更 → 使用（含手動編輯）
      // 2) 否則若選項群組結構有改 → 依目前選項現場重建
      const previewFresh = generatedVariants.length > 0 && generatedSignature === currentSignature();
      const variantsForRegen = previewFresh
        ? generatedVariants
        : (optionsChanged && groupsList.length > 0 ? buildVariants() : []);

      // Copy 的型號語意為「全部變體 × 全部 refs」（非逐變體），故去除 _modelGroup* 後
      // 以 buildModelRelationsPayload 的「全變體」模式產出，並供 variants 去重與選項連結使用
      const flatVariantsForRegen = variantsForRegen.map(v => ({
        ...v,
        _modelGroupId: undefined,
        _modelGroupType: undefined,
      }));

      if (flatVariantsForRegen.length > 0) {
        // 重新生成變體：先刪除剛複製的變體（全新、無引用），避免 batch_upsert
        // 依新 SKU 重建時殘留 -COPY-XXXX 的孤兒變體。
        const { error: delErr } = await supabase
          .from('product_variants')
          .delete()
          .eq('product_id', newProductId);
        if (delErr) throw delErr;

        // 驗證 SKU：不得為空、不得重複
        const skuSeen = new Set<string>();
        for (const v of flatVariantsForRegen) {
          const sku = v.sku.trim();
          if (!sku) {
            toast.error('有變體缺少 SKU，請到「變體預覽」補齊');
            return;
          }
          if (skuSeen.has(sku.toUpperCase())) {
            toast.error(`有重複 SKU：${sku}，請到「變體預覽」修正`);
            return;
          }
          skuSeen.add(sku.toUpperCase());
        }

        const dedupedVariants = buildDedupedVariantsPayload(flatVariantsForRegen);
        const groupsPayload = buildGroupsPayload(groupsList);
        const variantOptionsPayload = buildVariantOptionsPayload(groupsList, flatVariantsForRegen);
        const modelRelationsPayload = buildModelRelationsPayload(flatVariantsForRegen, selectedDeviceRefs);

        const { error: rpcError } = await supabase.rpc('batch_upsert_product_options', {
          p_product_id: newProductId,
          p_groups: groupsPayload,
          p_variants: dedupedVariants,
          p_variant_options: variantOptionsPayload,
          p_model_relations: modelRelationsPayload,
        });
        if (rpcError) throw rpcError;
      } else if (modelsChanged) {
        // 僅型號群組修改 → 直接替換複製變體的 model relations
        const { data: newVariants } = await supabase
          .from('product_variants')
          .select('id')
          .eq('product_id', newProductId);

        if (newVariants && newVariants.length > 0) {
          const variantIds = newVariants.map(v => v.id);

          await supabase.from('entity_model_relations')
            .delete()
            .in('variant_id', variantIds)
            .eq('relation_type', 'include');

          const inserts: any[] = [];
          const deviceOrder = new Map<string, number>();
          selectedDeviceRefs.forEach((ref, idx) => deviceOrder.set(ref.id, idx));
          for (const vId of variantIds) {
            for (const ref of selectedDeviceRefs) {
              const row: any = { variant_id: vId, relation_type: 'include', sort_order: deviceOrder.get(ref.id) ?? 0 };
              if (ref.type === 'model') row.model_id = ref.id;
              else row.group_id = ref.id;
              inserts.push(row);
            }
          }
          if (inserts.length > 0) {
            const { error: relErr } = await (supabase.from('entity_model_relations') as any).insert(inserts);
            if (relErr) throw relErr;
          }
        }
      }

      toast.success('產品及其變體已完整複製');
      onCopied(newProductId);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(`複製失敗：${getErrorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const variantCount = () => {
    if (generatedVariants.length > 0) return generatedVariants.length;
    const groupsList = getActiveGroups(optionGroups);
    if (groupsList.length === 0) {
      return originalVariantCount > 0 ? originalVariantCount : (selectedDeviceRefs.length > 0 ? selectedDeviceRefs.length : 0);
    }
    return estimateComboCount(optionGroups, selectedDeviceRefs.length);
  };

  const previewStale = generatedVariants.length > 0 && generatedSignature !== currentSignature();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            複製產品
          </DialogTitle>
          <DialogDescription>
            複製「{product?.name}」並可選擇替換型號群組與選項群組
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="basic" className="flex-1">基本資訊</TabsTrigger>
            <TabsTrigger value="models" className="flex-1">
              型號群組
              {selectedDeviceRefs.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{selectedDeviceRefs.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="options" className="flex-1">
              選項群組
              {optionGroups.some(g => g.values.length > 0) && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {optionGroups.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex-1">
              變體預覽
              {generatedVariants.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{generatedVariants.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="copy-name">產品名稱</Label>
              <Input
                id="copy-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="輸入新產品名稱"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="copy-sku">SKU 前綴</Label>
              <Input
                id="copy-sku"
                value={skuPrefix}
                onChange={(e) => setSkuPrefix(e.target.value)}
                placeholder="輸入 SKU 前綴（如 IMOS-COPY）"
              />
              <p className="text-xs text-muted-foreground">
                重新生成變體時以此為 SKU 前綴；若完全未修改選項，將沿用原變體 SKU。
              </p>
            </div>
          </TabsContent>

          <TabsContent value="models" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              選擇要替換的型號/群組。不選則保留原始型號綁定；有修改且無重新生成變體時，會直接替換現有變體的型號關聯。
            </p>
            <StandaloneDeviceModelSelectField
              selectionOrder={selectedDeviceRefs}
              onOrderChange={setSelectedDeviceRefs}
            />
          </TabsContent>

          <TabsContent value="options" className="mt-4 space-y-4">
            {loadingOptions ? (
              <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  修改選項群組結構（含每個選項值的 SKU 值、批發價／零售價）。不修改則保留原始選項。修改後變體將重新生成。
                </p>
                <VariantOptionsEditor
                  groups={optionGroups}
                  onChange={setOptionGroups}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="preview" className="mt-4 space-y-3">
            <Button onClick={generatePreview} className="w-full" variant="secondary">
              <Sparkles className="mr-2 h-4 w-4" />
              生成變體預覽
            </Button>

            {previewStale && (
              <div className="flex items-center gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>選項／型號／SKU 前綴已變更，請重新生成預覽；未重新生成時，複製將依目前選項自動重建（會覆寫你的修改）。</span>
              </div>
            )}

            {generatedVariants.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">預覽（{generatedVariants.length} 個變體，可直接編輯）</h4>
                  <Badge variant="outline">價格預設取自原產品，可修改</Badge>
                </div>
                <VariantPreviewTable
                  variants={generatedVariants}
                  onUpdate={updateVariantField}
                  onRemove={removeVariantItem}
                />
                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span>複製時將以這份清單重新生成變體；SKU 不可重複或留空。</span>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="border-t pt-4 mt-4 space-y-2">
          <h4 className="text-sm font-medium">預覽摘要</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>名稱：<span className="font-medium">{newName || product?.name}</span></div>
            <div>SKU 前綴：<span className="font-mono text-xs">{skuPrefix}</span></div>
            {selectedDeviceRefs.length > 0 && (
              <div>型號群組：<span className="font-medium">{selectedDeviceRefs.length} 個</span></div>
            )}
            <div>
              {generatedVariants.length > 0 ? '已生成變體' : '預估變體數'}：
              <span className="font-medium">
                {variantCount()} 個
                {originalVariantCount > 0 && variantCount() !== originalVariantCount && (
                  <span className="text-muted-foreground ml-1">（原 {originalVariantCount} 個）</span>
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={handleCopy} disabled={saving || !newName.trim()}>
            {saving ? '複製中...' : '確認複製'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}