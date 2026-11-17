import { useMemo, useState, useRef, useEffect, useDeferredValue } from 'react';
import { useProductCache } from '@/hooks/useProductCache';
import { supabase } from '@/integrations/supabase/client';
import { InternalProductSelector } from '@/pages/admin/purchase-orders/components/mapping/InternalProductSelector';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { CheckCircle2, Plus, Pencil, AlertTriangle, Minus, ChevronDown, ChevronRight, FileUp, ClipboardPaste, Upload, X, Tag, DollarSign } from 'lucide-react';
import { parseSupplierProductExcel, parseSupplierProductText } from '@/utils/supplierProductParser';
import { matchSupplierProducts, summarizeDiffs } from '@/utils/supplierProductMatcher';
import { SupplierProduct, ProductDiff, DiffAction } from '@/utils/supplierProductSchema';
import { useSupplierMappings } from '@/pages/admin/purchase-orders/hooks/useSupplierMappings';

interface SupplierProductDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierName?: string;
  supplierId?: string;
  initialProducts?: SupplierProduct[];
  excludedProducts?: { product: { name: string; vendor_product_id: string }; reason: string }[];
}

const ACTION_LABELS: Record<DiffAction, string> = {
  create: '新增',
  update: '更新',
  unchanged: '無變更',
  conflict: '衝突',
  applied: '已套用',
};

const ACTION_BADGE_CLASSES: Record<DiffAction, string> = {
  create: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  update: 'bg-blue-100 text-blue-800 border-blue-200',
  unchanged: 'bg-muted text-muted-foreground border-border',
  conflict: 'bg-amber-100 text-amber-800 border-amber-200',
  applied: 'bg-gray-100 text-gray-600 border-gray-300',
};

const ACTION_ICONS: Record<DiffAction, React.ReactNode> = {
  create: <Plus className="h-3.5 w-3.5" />,
  update: <Pencil className="h-3.5 w-3.5" />,
  unchanged: <Minus className="h-3.5 w-3.5" />,
  conflict: <AlertTriangle className="h-3.5 w-3.5" />,
  applied: <CheckCircle2 className="h-3.5 w-3.5" />,
};

export function SupplierProductDiffDialog({
  open,
  onOpenChange,
  supplierName,
  supplierId,
  initialProducts,
  excludedProducts,
}: SupplierProductDiffDialogProps) {
  const { products } = useProductCache();
  const { mappings, isLoadingMappings } = useSupplierMappings(supplierId);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<SupplierProduct[] | null>(null);
  const [diffs, setDiffs] = useState<ProductDiff[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [actionFilter, setActionFilter] = useState<DiffAction | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [changeFieldFilter, setChangeFieldFilter] = useState<string>('all');
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
  const [searchText, setSearchText] = useState('');
  // 輸入時先更新輸入框，篩選計算延後，避免每次按鍵都阻塞主執行緒
  const deferredSearchText = useDeferredValue(searchText);
  const [showExcluded, setShowExcluded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [assigningIdx, setAssigningIdx] = useState<number | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const reset = () => {
    setParsed(null);
    setDiffs([]);
    setSelected(new Set());
    setExpanded(new Set());
    setPastedText('');
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActionFilter('all');
    setCategoryFilter('all');
    setSkippedIndices(new Set());
    setSearchText('');
    setApplying(false);
    setAssigningIdx(null);
    setSelectorOpen(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const processProducts = async (supplierProducts: SupplierProduct[]) => {
    setParsed(supplierProducts);
    
    // 讀取已忽略的產品（scrape_decisions）
    let ignoredIds = new Set<string>();
    if (supplierId) {
      try {
        const { data } = await (supabase as any)
          .from('scrape_decisions')
          .select('vendor_product_id')
          .eq('supplier_id', supplierId)
          .eq('action', 'skip');
        if (data) {
          ignoredIds = new Set(data.map((d: any) => d.vendor_product_id));
        }
      } catch (err) {
        console.error('讀取 scrape_decisions 失敗:', err);
      }
    }
    
    // 過濾已忽略的產品
    const filtered = supplierProducts.filter(sp => !ignoredIds.has(sp.supplier_sku));
    
    const result = matchSupplierProducts(filtered, products as any, mappings);
    setDiffs(result);
    const initial = new Set<number>();
    result.forEach((d, i) => {
      if (d.action === 'create' || d.action === 'update' || d.action === 'conflict') {
        initial.add(i);
      }
    });
    setSelected(initial);
  };

  const handleFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      setFileName(file.name);
      const isCsv = /\.csv$/i.test(file.name);
      let result: SupplierProduct[];
      if (isCsv) {
        const text = new TextDecoder('utf-8').decode(buffer);
        result = await parseSupplierProductText(text);
      } else {
        result = await parseSupplierProductExcel(buffer);
      }
      if (result.length === 0) {
        toast.error('檔案中沒有可辨識的產品資料');
        return;
      }
      processProducts(result);
      toast.success(`解析完成：${result.length} 筆產品`);
    } catch (err) {
      toast.error('解析失敗', { description: String(err) });
    }
  };

  const handleParsePaste = async () => {
    if (!pastedText.trim()) {
      toast.error('請先貼上內容');
      return;
    }
    try {
      const result = await parseSupplierProductText(pastedText);
      if (result.length === 0) {
        toast.error('內容中沒有可辨識的產品資料');
        return;
      }
      processProducts(result);
      toast.success(`解析完成：${result.length} 筆產品`);
    } catch (err) {
      toast.error('解析失敗', { description: String(err) });
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = (action: DiffAction) => {
    const indices = diffs.map((d, i) => (d.action === action ? i : -1)).filter(i => i >= 0);
    const allSelected = indices.every(i => selected.has(i));
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) indices.forEach(i => next.delete(i));
      else indices.forEach(i => next.add(i));
      return next;
    });
  };

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSkip = (idx: number) => {
    setSkippedIndices(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };

  // 輔助函式：從名稱解析狀態標記
  // oldName: 舊名稱（mapping 儲存的名稱），newName: 爬取的新名稱
  // 新名稱有標記 → 使用新標記
  // 新名稱無標記但舊名稱有標記 → 產品已脫離該狀態，恢復為 active/visible
  // 新舊皆無標記 → 不變更（null）
  const parseStatusFromNames = (oldName: string, newName: string): { isHidden: boolean | null; variantStatus: string | null } => {
    const parseOne = (name: string): { isHidden: boolean; variantStatus: string } | null => {
      if (name.includes('停產')) return { isHidden: true, variantStatus: 'discontinued' };
      if (name.includes('售完')) return { isHidden: true, variantStatus: 'sold_out' };
      if (name.includes('缺貨')) return { isHidden: true, variantStatus: 'sold_out' };
      if (name.includes('預購')) return { isHidden: false, variantStatus: 'preorder' };
      return null;
    };
    const oldStatus = parseOne(oldName);
    const newStatus = parseOne(newName);
    if (newStatus) return newStatus;
    if (oldStatus) return { isHidden: false, variantStatus: 'active' };
    return { isHidden: null, variantStatus: null };
  };

  // 套用已勾選的項目
  const handleApply = async () => {
    if (!supplierId || selected.size === 0) return;
    setApplying(true);
    let successCount = 0;
    let errorCount = 0;

    const appliedIndices = new Set<number>();

    for (const idx of selected) {
      const diff = diffs[idx];
      if (!diff) continue;

      try {
        const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);

        if (mapping) {
          // 計算新舊名稱
          const nameChange = (diff.changes || []).find(c => c.field === 'name');
          const oldName = nameChange
            ? (nameChange.old_value as string || mapping.vendor_product_name || '')
            : (mapping.vendor_product_name || diff.supplier_product.name || '');
          const newName = diff.supplier_product.name || '';
          const status = parseStatusFromNames(oldName, newName);

          // 若有狀態需要同步 → 使用 RPC 原子化更新（涵蓋所有 action，包括 unchanged）
          if (status.isHidden !== null || status.variantStatus !== null) {
            const rpcParams: Record<string, any> = {
              p_mapping_id: mapping.id,
            };
            // update/conflict 時同時更新名稱/成本
            if (diff.action === 'update' || diff.action === 'conflict') {
              for (const change of diff.changes || []) {
                if (change.field === 'name') rpcParams.p_vendor_product_name = diff.supplier_product.name;
                if (change.field === 'wholesale_price') rpcParams.p_vendor_unit_cost = diff.supplier_product.wholesale_price;
              }
              if (diff.action === 'conflict') {
                if (diff.supplier_product.name && !rpcParams.p_vendor_product_name) rpcParams.p_vendor_product_name = diff.supplier_product.name;
                if (diff.supplier_product.wholesale_price !== undefined && !rpcParams.p_vendor_unit_cost) rpcParams.p_vendor_unit_cost = diff.supplier_product.wholesale_price;
              }
            }
            if (status.isHidden !== null) rpcParams.p_is_hidden = status.isHidden;
            if (status.variantStatus !== null) {
              rpcParams.p_variant_status = status.variantStatus;
              if (diff.matched_variant_id) rpcParams.p_variant_id = diff.matched_variant_id;
            }

            const { data, error } = await (supabase as any).rpc('sync_supplier_mapping_status', rpcParams);
            if (error) throw error;
            if (data && data.ok === false) throw new Error(data.reason || '同步失敗');

            successCount++;
            appliedIndices.add(idx);
            continue; // 已處理，跳過後續 action-specific 邏輯
          }
        }

        // 無狀態變更 → 根據 action 執行原有邏輯
        if (diff.action === 'update') {
          const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);
          if (mapping) {
            const updates: Record<string, any> = { updated_at: new Date().toISOString() };
            for (const change of diff.changes || []) {
              if (change.field === 'name') updates.vendor_product_name = diff.supplier_product.name;
              if (change.field === 'wholesale_price') updates.vendor_unit_cost = diff.supplier_product.wholesale_price;
            }
            const { error } = await (supabase as any)
              .from('supplier_product_mappings')
              .update(updates)
              .eq('id', mapping.id);
            if (error) throw error;
            successCount++;
            appliedIndices.add(idx);
          }
        } else if (diff.action === 'create') {
          setAssigningIdx(idx);
          setSelectorOpen(true);
          setApplying(false);
          return;
        } else if (diff.action === 'conflict') {
          const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);
          if (mapping) {
            const updates: Record<string, any> = { updated_at: new Date().toISOString() };
            if (diff.supplier_product.name) updates.vendor_product_name = diff.supplier_product.name;
            if (diff.supplier_product.wholesale_price !== undefined) updates.vendor_unit_cost = diff.supplier_product.wholesale_price;
            const { error } = await (supabase as any)
              .from('supplier_product_mappings')
              .update(updates)
              .eq('id', mapping.id);
            if (error) throw error;
            successCount++;
            appliedIndices.add(idx);
          }
        } else if (diff.action === 'unchanged') {
          // 無狀態變更且無其他變更 → 跳過
          continue;
        }
      } catch (err) {
        console.error('套用失敗:', err);
        errorCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`成功更新 ${successCount} 筆對照關係`);
      // 將已套用的項目 action 改為 'applied'，讓它們移到「已套用」TAB
      setDiffs(prev => prev.map((d, i) => appliedIndices.has(i) ? { ...d, action: 'applied' as DiffAction } : d));
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} 筆更新失敗`);
    }

    if (initialProducts) {
      setDiffs([]);
      setSelected(new Set());
      setSkippedIndices(new Set());
      setTimeout(() => { processProducts(initialProducts); }, 500);
    }

    setApplying(false);
  };

  const handleAssignComplete = async (internalProdId: string, internalVarId: string | null) => {
    if (assigningIdx === null) return;
    const diff = diffs[assigningIdx];
    if (!diff) return;

    try {
      const { error } = await (supabase
        .from('supplier_product_mappings') as any)
        .insert({
          supplier_id: supplierId,
          vendor_product_id: diff.supplier_product.supplier_sku,
          vendor_product_name: diff.supplier_product.name,
          internal_product_id: internalProdId,
          internal_variant_id: internalVarId,
          vendor_unit_cost: diff.supplier_product.wholesale_price,
          is_primary: true,
        });

      if (error) throw error;
      toast.success('對照關係已建立');

      // 標記為已處理
      setSkippedIndices(prev => {
        const next = new Set(prev);
        next.add(assigningIdx);
        return next;
      });
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(assigningIdx);
        return next;
      });

      // 繼續處理下一個 create 項目
      const nextCreateIdx = Array.from(selected).find(idx => {
        const d = diffs[idx];
        return d?.action === 'create' && idx !== assigningIdx;
      });

      if (nextCreateIdx !== undefined) {
        setAssigningIdx(nextCreateIdx);
        // 不關閉 selector，繼續指派
      } else {
        setSelectorOpen(false);
        setAssigningIdx(null);
        // 重新比對
        if (initialProducts) {
          setDiffs([]);
          setSelected(new Set());
          setSkippedIndices(new Set());
          setTimeout(() => { processProducts(initialProducts); }, 500);
        }
      }
    } catch (err) {
      toast.error('建立對照失敗', { description: String(err) });
    }
  };

  const handleAssignClose = () => {
    setSelectorOpen(false);
    setAssigningIdx(null);
  };

  // 忽略某個項目（持久化到 scrape_decisions）
  const handleSkipPersistent = async (idx: number) => {
    const diff = diffs[idx];
    if (!diff || !supplierId) return;

    try {
      await (supabase as any).from('scrape_decisions').upsert({
        supplier_id: supplierId,
        vendor_product_id: diff.supplier_product.supplier_sku,
        action: 'skip',
        note: '使用者手動忽略',
      }, { onConflict: 'supplier_id,vendor_product_id' });

      toast.success('已忽略此產品');
    } catch (err) {
      console.error('寫入 scrape_decisions 失敗:', err);
    }

    handleSkip(idx);
  };

  const summary = useMemo(() => summarizeDiffs(diffs), [diffs]);

  // 預先建立 vendor_product_id -> mapping 的 Map，避免在迴圈中重複 O(n*m) 查找
  const mappingBySku = useMemo(() => {
    const m = new Map<string, any>();
    (mappings || []).forEach((mm: any) => {
      if (mm?.vendor_product_id) m.set(mm.vendor_product_id, mm);
    });
    return m;
  }, [mappings]);

  // 只保留「符合條件的原始 index」，避免 render 時再用 diffs.indexOf() 造成 O(n²)
  const filteredIndices = useMemo(() => {
    const search = deferredSearchText.trim().toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      if (skippedIndices.has(i)) continue;
      if (actionFilter !== 'all' && d.action !== actionFilter) continue;
      if (categoryFilter !== 'all' && d.supplier_product.category !== categoryFilter) continue;
      if (changeFieldFilter !== 'all' && !(d.changes || []).some((c: any) => c.field === changeFieldFilter)) continue;
      if (search) {
        const mapping = mappingBySku.get(d.supplier_product.supplier_sku);
        const internalName = mapping?.internal_variant?.name || mapping?.internal_product?.name || '';
        const haystack = `${d.supplier_product.name || ''} ${d.supplier_product.supplier_sku || ''} ${internalName}`.toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      out.push(i);
    }
    return out;
  }, [diffs, actionFilter, categoryFilter, changeFieldFilter, skippedIndices, deferredSearchText, mappingBySku]);

  // 分類計數直接從 filteredIndices 衍生，避免第二次 O(n*m) 掃描
  const categories = useMemo(() => {
    const catCount = new Map<string, number>();
    filteredIndices.forEach((i) => {
      const cat = diffs[i]?.supplier_product?.category;
      if (cat) catCount.set(cat, (catCount.get(cat) || 0) + 1);
    });
    return Array.from(catCount.entries()).map(([cat, count]) => ({ cat, count }));
  }, [filteredIndices, diffs]);

  const changeFields = useMemo(() => {
    const fields = new Set<string>();
    diffs.forEach(d => {
      (d.changes || []).forEach(c => fields.add(c.field));
    });
    return Array.from(fields);
  }, [diffs]);

  const handleSelectAll = () => {
    const newSelected = new Set<number>();
    filteredIndices.forEach((originalIdx) => {
      const d = diffs[originalIdx];
      if (skippedIndices.has(originalIdx)) return;
      // 選取所有非 unchanged 項目，以及有狀態標記的 unchanged 項目
      if (d.action !== 'unchanged' && d.action !== 'applied') {
        newSelected.add(originalIdx);
      } else if (d.action === 'unchanged') {
        const oldName = (d.changes || []).find((c: any) => c.field === 'name')?.old_value as string || '';
        const st = parseStatusFromNames(oldName, d.supplier_product.name || '');
        if (st.isHidden !== null || st.variantStatus !== null) {
          newSelected.add(originalIdx);
        }
      }
    });
    setSelected(newSelected);
  };

  const handleDeselectAll = () => {
    setSelected(new Set());
  };

  // 批次忽略所有已勾選的項目
  const handleBatchSkip = async () => {
    if (!supplierId || selected.size === 0) return;
    setApplying(true);

    const toSkip = Array.from(selected)
      .map(idx => diffs[idx])
      .filter(d => d && d.action !== 'unchanged' && d.action !== 'applied');

    if (toSkip.length === 0) {
      toast.info('沒有可忽略的項目');
      setApplying(false);
      return;
    }

    const rows = toSkip.map(d => ({
      supplier_id: supplierId,
      vendor_product_id: d.supplier_product.supplier_sku,
      action: 'skip',
      note: '使用者批次忽略',
    }));

    const { error } = await (supabase as any)
      .from('scrape_decisions')
      .upsert(rows, { onConflict: 'supplier_id,vendor_product_id' });

    if (error) {
      console.error('批次忽略失敗:', error);
      toast.error('批次忽略失敗', { description: error.message });
      setApplying(false);
      return;
    }

    // 將這些項目從畫面中移除
    const skippedSet = new Set(selected);
    setSkippedIndices(prev => {
      const next = new Set(prev);
      skippedSet.forEach(i => next.add(i));
      return next;
    });
    setSelected(new Set());
    toast.success(`已忽略 ${toSkip.length} 筆產品`);
    setApplying(false);
  };

  const mappingsLoadedRef = useRef(false);
  // 當篩選條件變更時，重新初始化選取（只選取符合條件的項目）
  useEffect(() => {
    if (open && initialProducts && initialProducts.length > 0 && !isLoadingMappings && supplierId && diffs.length === 0 && !mappingsLoadedRef.current) {
      mappingsLoadedRef.current = true;
      processProducts(initialProducts);
    }
    if (!open) {
      reset();
      mappingsLoadedRef.current = false;
    }
  }, [open, initialProducts, isLoadingMappings, supplierId]);

  // 當篩選條件變更時，重新初始化選取（只選取符合條件的項目）
  useEffect(() => {
    if (diffs.length === 0) return;
    const newSelected = new Set<number>();
    diffs.forEach((d, i) => {
      if (skippedIndices.has(i)) return;
      if (actionFilter !== 'all' && d.action !== actionFilter) return;
      if (categoryFilter !== 'all' && d.supplier_product.category !== categoryFilter) return;
      if (d.action === 'create' || d.action === 'update' || d.action === 'conflict') {
        newSelected.add(i);
      }
    });
    setSelected(newSelected);
  }, [actionFilter, categoryFilter]);

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>供應商產品匯入與比對</DialogTitle>
          <DialogDescription>
            {supplierName ? `供應商：${supplierName}` : '上傳或貼上供應商產品資料，系統將與現有產品比對'}
          </DialogDescription>
        </DialogHeader>

        {diffs.length === 0 ? (
          <div className="flex-1 min-h-0">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'paste')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload" className="gap-1.5">
                  <Upload className="h-4 w-4" /> 上傳檔案
                </TabsTrigger>
                <TabsTrigger value="paste" className="gap-1.5">
                  <ClipboardPaste className="h-4 w-4" /> 貼上內容
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-4 space-y-3">
                <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
                  <FileUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm mb-3">支援 CSV / Excel（.xlsx / .xls）</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    選擇檔案
                  </Button>
                  {fileName && (
                    <p className="text-xs mt-2 text-foreground">已選擇：{fileName}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  欄位對應：廠商料號、品名、批發價、零售價、描述、品牌、分類、條碼、重量、圖片、變體SKU 等（中英欄名皆可）
                </p>
              </TabsContent>

              <TabsContent value="paste" className="mt-4 space-y-3">
                <Textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="貼上 CSV 或 Tab 分隔的內容..."
                  className="min-h-[200px] font-mono text-xs"
                />
                <Button onClick={handleParsePaste} className="w-full">
                  <ClipboardPaste className="h-4 w-4 mr-1.5" />
                  解析內容
                </Button>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <>
            {/* 篩選器 */}
            <div className="flex flex-wrap items-center gap-2 py-2">
              {(['create', 'update', 'unchanged', 'conflict', 'applied'] as DiffAction[]).map(action => (
                <Badge
                  key={action}
                  variant="outline"
                  className={`gap-1.5 cursor-pointer ${ACTION_BADGE_CLASSES[action]} ${actionFilter === action ? 'ring-2 ring-primary' : ''}`}
                  onClick={() => setActionFilter(prev => prev === action ? 'all' : action)}
                >
                  {ACTION_ICONS[action]}
                  {ACTION_LABELS[action]} {summary[action]}
                </Badge>
              ))}
              {categories.length > 1 && (
                <select
                  className="text-xs border rounded px-2 py-1 bg-background"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">全部分類</option>
                  {categories.map(({ cat, count }) => (
                    <option key={cat} value={cat}>{cat} ({count})</option>
                  ))}
                </select>
              )}
              <Input
                className="text-xs h-7 w-40"
                placeholder="搜尋產品名/SKU..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              {changeFields.length > 0 && (
                <select
                  className="text-xs border rounded px-2 py-1 bg-background"
                  value={changeFieldFilter}
                  onChange={(e) => setChangeFieldFilter(e.target.value)}
                >
                  <option value="all">全部變更</option>
                  {changeFields.map(field => (
                    <option key={field} value={field}>{field === 'name' ? '品名' : field === 'wholesale_price' ? '批發價' : field === 'retail_price' ? '零售價' : field}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-1 ml-auto">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => {
                   const allSelected = filteredIndices.every((idx) => selected.has(idx));



                  if (allSelected) {
                    handleDeselectAll();
                  } else {
                    handleSelectAll();
                  }
                }}>
                   {filteredIndices.every((idx) => selected.has(idx)) ? '全取消' : '全選'}
                </Button>
              </div>
              {skippedIndices.size > 0 && (
                <Badge variant="outline" className="gap-1.5 text-muted-foreground">
                  已忽略 {skippedIndices.size}
                </Badge>
              )}
            </div>

            {/* 被排除產品摘要 */}
            {excludedProducts && excludedProducts.length > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm mb-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowExcluded(!showExcluded)}
                >
                  {showExcluded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  已排除 {excludedProducts.length} 筆產品
                </button>
                {showExcluded && (
                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {excludedProducts.slice(0, 50).map((e, i) => (
                      <div key={i} className="text-xs text-muted-foreground">
                        {e.product.name?.substring(0, 60)} — {e.reason}
                      </div>
                    ))}
                    {excludedProducts.length > 50 && (
                      <div className="text-xs text-muted-foreground">...還有 {excludedProducts.length - 50} 筆</div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 w-full rounded-md border overflow-y-auto overflow-x-hidden" style={{ maxHeight: 'calc(85vh - 220px)' }}>
              <div className="space-y-2 p-3">
                {filteredIndices.length === 0 && diffs.length > 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    沒有符合篩選條件的項目
                  </div>
                ) : (
                  filteredIndices.map((originalIdx, idx) => {
                    const diff = diffs[originalIdx];
                    const isExpanded = expanded.has(originalIdx);
                    const isSelected = selected.has(originalIdx);
                    return (
                      <div
                        key={originalIdx}
                        className={`rounded-lg border p-3 transition-colors ${
                          isSelected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {diff.action !== 'unchanged' && diff.action !== 'applied' && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(originalIdx)}
                              className="mt-1"
                            />
                          )}
                          {(diff.action === 'unchanged' || diff.action === 'applied') && <div className="w-4" />}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={`gap-1 ${ACTION_BADGE_CLASSES[diff.action]}`}>
                                {ACTION_ICONS[diff.action]}
                                {ACTION_LABELS[diff.action]}
                              </Badge>
                              {(() => {
                                const oldName = (diff.changes || []).find(c => c.field === 'name')?.old_value as string || '';
                                const newName = diff.supplier_product.name || '';
                                const st = parseStatusFromNames(oldName, newName);
                                if (!st.isHidden && st.variantStatus === null) return null;
                                const isStatusChange = st.variantStatus !== null;
                                if (!isStatusChange) return null;
                                return (
                                  <Badge variant="outline" className="gap-1 bg-purple-100 text-purple-800 border-purple-200">
                                    <Tag className="h-3 w-3" />
                                    上架狀態
                                  </Badge>
                                );
                              })()}
                              {(diff.changes || []).some(c => c.field === 'wholesale_price' || c.field === 'retail_price') && (
                                <Badge variant="outline" className="gap-1 bg-orange-100 text-orange-800 border-orange-200">
                                  <DollarSign className="h-3 w-3" />
                                  價格變更
                                </Badge>
                              )}
                              <span className="font-medium text-sm break-words">
                                {diff.supplier_product.name}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono break-all">
                                {diff.supplier_product.supplier_sku}
                              </span>
                              {(() => {
                                const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);
                                if (!mapping) return null;
                                const displayName = mapping.internal_variant?.name || mapping.internal_product?.name || '未知';
                                return (
                                  <span className="text-xs text-muted-foreground">
                                    → {displayName}
                                  </span>
                                );
                              })()}
                              {diff.action !== 'unchanged' && diff.action !== 'applied' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 ml-auto"
                                  onClick={() => handleSkipPersistent(originalIdx)}
                                >
                                  <X className="h-3 w-3 mr-1" />
                                  忽略
                                </Button>
                              )}
                            </div>

                            {diff.reason && (
                              <p className="text-xs text-muted-foreground mt-1">{diff.reason}</p>
                            )}

                            {diff.changes && diff.changes.length > 0 && (
                              <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-primary mt-1.5 hover:underline"
                                onClick={() => toggleExpand(originalIdx)}
                              >
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {diff.changes.length} 個欄位變更
                              </button>
                            )}

                            {isExpanded && diff.changes && (
                              <div className="mt-2 rounded border bg-muted/30 p-2 space-y-1">
                                {diff.changes.map((change, ci) => (
                                  <div key={ci} className="flex items-start gap-2 text-xs">
                                    <span className="font-medium text-muted-foreground w-16 shrink-0">
                                      {change.label}
                                    </span>
                                    <span className="text-destructive line-through">
                                      {String(change.old_value ?? '—')}
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-emerald-700">
                                      {String(change.new_value ?? '—')}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })  // end filteredDiffs.map
                )}
              </div>
            </div>

            <DialogFooter className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                已勾選 {selected.size} / {diffs.length - skippedIndices.size} 筆
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { reset(); }}>重新匯入</Button>
                <Button variant="outline" onClick={() => handleClose(false)}>關閉</Button>
                {selected.size > 0 && (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleBatchSkip}
                      disabled={applying}
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    >
                      <X className="h-4 w-4 mr-1" />
                      忽略已勾選 ({selected.size})
                    </Button>
                    <Button onClick={handleApply} disabled={applying}>
                      {applying ? '套用中...' : `套用已勾選 (${selected.size})`}
                    </Button>
                  </>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* 指派內部產品對話框（用於 create 項目） */}
    <Dialog open={selectorOpen} onOpenChange={(open) => { if (!open) handleAssignClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            指派內部產品
            {assigningIdx !== null && diffs[assigningIdx] && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({diffs[assigningIdx].supplier_product.name?.substring(0, 40)})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            搜尋並選擇系統內的產品與變體，建立與廠商代號的連結對照關係。
          </DialogDescription>
        </DialogHeader>
        {selectorOpen && (
          <InternalProductSelector
            onSelect={handleAssignComplete}
            onClose={handleAssignClose}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
