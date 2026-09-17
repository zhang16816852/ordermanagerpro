import { useEffect, useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errorMessages';
import type { DeviceSelectionRef } from '../StandaloneDeviceModelSelectField';
import { useDeviceModelStore } from '@/store/useDeviceModelStore';
import { useColorStore } from '@/store/useColorStore';
import { checkVariantReferences, groupReferencesByVariant } from '@/utils/variantReferenceCheck';
import {
  type OptionGroupInput,
  type OptionGroupSuggestion,
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
  createOptionGroup,
  createOptionValue,
} from '@/utils/variantGeneration';
import {
  loadExistingBatchData,
  fetchOptionSuggestions,
  resolveDeviceItems,
  mergeWithExisting,
} from './variantBatchCreatorUtils';
import type { DiffSummary, OrphanConfirmState, Product, VariantBatchCreatorProps } from './variantBatchCreatorTypes';

export function useVariantBatchCreator({ open, onOpenChange, product, onSuccess }: VariantBatchCreatorProps) {
  const [optionGroups, setOptionGroups] = useState<OptionGroupInput[]>([]);
  const [barcodeList, setBarcodeList] = useState('');
  const [selectedDeviceRefs, setSelectedDeviceRefs] = useState<DeviceSelectionRef[]>([]);
  const [defaultWholesalePrice, setDefaultWholesalePrice] = useState('');
  const [defaultRetailPrice, setDefaultRetailPrice] = useState('');
  const [generatedVariants, setGeneratedVariants] = useState<SharedVariant[]>([]);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [orphanConfirm, setOrphanConfirm] = useState<OrphanConfirmState | null>(null);
  const [suggestions, setSuggestions] = useState<OptionGroupSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const isUnified = !!product?.unified_pricing;
  const loadExistingDataDbValueToColorId = useRef(new Map<string, string>());
  const existingDbVariantsRef = useRef<SharedVariant[]>([]);
  const orphanCleanupRef = useRef<string[]>([]);

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
      const data = await loadExistingBatchData(product, libraryColors);
      loadExistingDataDbValueToColorId.current = data.dbValueToColorId;
      setOptionGroups(data.optionGroups);

      if (data.dbVariants.length === 0) return;

      setSelectedDeviceRefs(data.selectedDeviceRefs);

      setGeneratedVariants(data.dbVariants);
      existingDbVariantsRef.current = data.dbVariants;

      if (data.dbVariants.length > 0) {
        toast.success(`已載入 ${data.dbVariants.length} 個現有變體`);
      }
    } catch (err) {
      console.error('載入資料失敗:', err);
    }
  };

  const fetchSuggestions = async () => {
    try {
      setSuggestionsLoading(true);
      const loaded = await fetchOptionSuggestions(product);
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

  const generateVariants = () => {
    const unnamedGroups = optionGroups.filter(g => !g.name.trim() && g.values.some(v => v.label.trim()));
    if (unnamedGroups.length > 0) {
      toast.error(`有 ${unnamedGroups.length} 個選項群組未填寫名稱，請補填名稱後再生成`);
      return;
    }

    const activeGroups = getActiveGroups(optionGroups);
    const modelGroupItems = resolveDeviceItems(selectedDeviceRefs, deviceModels, deviceGroups);
    const codePrefix = product.code || 'PROD';
    const defaults = {
      wholesale: isUnified ? Number(product?.unified_wholesale_price ?? 0) : (parseFloat(defaultWholesalePrice) || 0),
      retail: isUnified ? Number(product?.unified_retail_price ?? 0) : (parseFloat(defaultRetailPrice) || 0),
    };

    if (activeGroups.length === 0) {
      // No option groups — only device models path
      if (selectedDeviceRefs.length === 0) {
        toast.error('請至少建立一個選項群組並輸入值，或選擇型號/群組');
        return;
      }
      const combos = generateVariantCombos({
        optionGroups,
        modelItems: modelGroupItems,
        prefix: codePrefix,
        baseName: product.name,
        priceMap: new Map(),
        defaults,
        unified: isUnified ? { ...defaults } : null,
      });
      const variants = buildVariantPayload({
        combos,
        prefix: codePrefix,
        baseName: product.name,
        priceMap: new Map(),
        defaults,
        unified: isUnified ? { ...defaults } : null,
      });
      setGeneratedVariants(mergeGenerated(variants));
      return;
    }

    const priceMap = buildPriceMap(optionGroups);
    const combos = generateVariantCombos({
      optionGroups,
      modelItems: modelGroupItems,
      prefix: codePrefix,
      baseName: product.name,
      priceMap,
      defaults,
      unified: isUnified ? { ...defaults } : null,
    });
    const barcodeLines = barcodeList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const variants = buildVariantPayload({
      combos,
      prefix: codePrefix,
      baseName: product.name,
      priceMap,
      defaults,
      unified: isUnified ? { ...defaults } : null,
      barcodeLines,
    });

    if (variants.length === 0) {
      toast.error('無法生成變體，請檢查輸入');
      return;
    }

    setGeneratedVariants(mergeGenerated(variants));
  };

  const mergeGenerated = (newVariants: SharedVariant[]): SharedVariant[] => {
    const existingList = generatedVariants;
    const { merged, diff } = mergeWithExisting(newVariants, existingList, existingDbVariantsRef.current);
    setDiffSummary(diff);
    return merged;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (generatedVariants.length === 0) throw new Error('請先生成變體');

      // 本次儲存預期的孤兒清理（於儲存前經 handleSave 檢查並設定）
      const orphanIds = orphanCleanupRef.current;
      orphanCleanupRef.current = [];

      // 單一交易：所有 option groups / values / variant_options / variants /
      // entity_model_relations 的刪除與重建，交由 RPC 在一個 database
      // transaction 內完成，失敗自動 ROLLBACK，避免先刪後建造成的資料遺失。

      const groupsPayload = buildGroupsPayload(optionGroups);
      const dedupedVariants = buildDedupedVariantsPayload(generatedVariants);
      const variantOptionsPayload = buildVariantOptionsPayload(optionGroups, generatedVariants);
      const modelRelationsPayload = buildModelRelationsPayload(generatedVariants, selectedDeviceRefs);

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

      // 清理未被生成的既有變體（僅限已檢查無參考、且使用者已確認的）
      if (orphanIds.length > 0) {
        await Promise.all(
          orphanIds.map(id => supabase.rpc('delete_variant_if_safe', { p_variant_id: id })),
        );
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

  const handleSave = async () => {
    if (generatedVariants.length === 0) {
      toast.error('請先生成變體');
      return;
    }

    // 找出未被產生的既有 DB 變體（潛在孤兒），檢查是否被業務資料引用
    const payloadSkuSet = new Set(generatedVariants.map(v => v.sku));
    const orphans = existingDbVariantsRef.current.filter(v => !payloadSkuSet.has(v.sku));

    if (orphans.length > 0) {
      const checkResult = await checkVariantReferences(orphans.map(o => o._dbId!).filter(Boolean));
      const byVariant = groupReferencesByVariant(checkResult.referenced);
      const referencedOrphans = orphans
        .filter(o => byVariant.has(o._dbId!))
        .map(o => ({ variant: o, refs: byVariant.get(o._dbId!)!.tables }));
      const unreferencedToDelete = orphans.filter(o => !byVariant.has(o._dbId!));

      if (referencedOrphans.length > 0) {
        setOrphanConfirm({ referencedOrphans, unreferencedToDelete });
        return;
      }

      orphanCleanupRef.current = unreferencedToDelete.map(o => o._dbId!);
    }

    createMutation.mutate();
  };

  const proceedWithOrphans = () => {
    if (orphanConfirm) {
      orphanCleanupRef.current = orphanConfirm.unreferencedToDelete.map(o => o._dbId!);
    }
    setOrphanConfirm(null);
    createMutation.mutate();
  };

  const resetForm = () => {
    setOptionGroups([]);
    setSuggestions([]);
    setSelectedDeviceRefs([]);
    setDefaultWholesalePrice('');
    setDefaultRetailPrice('');
    setBarcodeList('');
    setGeneratedVariants([]);
    setDiffSummary(null);
    setOrphanConfirm(null);
    loadExistingDataDbValueToColorId.current = new Map();
    existingDbVariantsRef.current = [];
    orphanCleanupRef.current = [];
  };

  const updateVariantField = (index: number, field: VariantEditableField, value: string) => {
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

  const deviceNames = resolveDeviceItems(selectedDeviceRefs, deviceModels, deviceGroups).map(item => item.name);

  return {
    isUnified,
    product,
    optionGroups,
    setOptionGroups,
    suggestions,
    suggestionsLoading,
    importSuggestion,
    importAllSuggestions,
    selectedDeviceRefs,
    setSelectedDeviceRefs,
    barcodeList,
    setBarcodeList,
    defaultWholesalePrice,
    setDefaultWholesalePrice,
    defaultRetailPrice,
    setDefaultRetailPrice,
    generatedVariants,
    diffSummary,
    deviceNames,
    generateVariants,
    updateVariantField,
    removeVariant,
    handleSave,
    proceedWithOrphans,
    createMutation,
    resetForm,
    orphanConfirm,
    setOrphanConfirm,
    onOpenChange,
  };
}