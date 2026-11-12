import { useMemo, useState, useRef, useEffect } from 'react';
import { useProductCache } from '@/hooks/useProductCache';
import { supabase } from '@/integrations/supabase/client';
import { InternalProductSelector } from '@/pages/admin/purchase-orders/components/mapping/InternalProductSelector';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { CheckCircle2, Plus, Pencil, AlertTriangle, Minus, ChevronDown, ChevronRight, FileUp, ClipboardPaste, Upload, X } from 'lucide-react';
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
};

const ACTION_BADGE_CLASSES: Record<DiffAction, string> = {
  create: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  update: 'bg-blue-100 text-blue-800 border-blue-200',
  unchanged: 'bg-muted text-muted-foreground border-border',
  conflict: 'bg-amber-100 text-amber-800 border-amber-200',
};

const ACTION_ICONS: Record<DiffAction, React.ReactNode> = {
  create: <Plus className="h-3.5 w-3.5" />,
  update: <Pencil className="h-3.5 w-3.5" />,
  unchanged: <Minus className="h-3.5 w-3.5" />,
  conflict: <AlertTriangle className="h-3.5 w-3.5" />,
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
    setApplying(false);
    setAssigningIdx(null);
    setSelectorOpen(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const processProducts = (supplierProducts: SupplierProduct[]) => {
    setParsed(supplierProducts);
    const result = matchSupplierProducts(supplierProducts, products as any, mappings);
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

  // 套用已勾選的項目
  const handleApply = async () => {
    if (!supplierId || selected.size === 0) return;
    setApplying(true);
    let successCount = 0;
    let errorCount = 0;

    for (const idx of selected) {
      const diff = diffs[idx];
      if (!diff) continue;

      try {
        if (diff.action === 'update') {
          // 更新 mapping 的 vendor_product_name / vendor_unit_cost
          const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);
          if (mapping) {
            const updates: Record<string, any> = { updated_at: new Date().toISOString() };
            for (const change of diff.changes || []) {
              if (change.field === 'name') updates.vendor_product_name = diff.supplier_product.name;
              if (change.field === 'wholesale_price') updates.vendor_unit_cost = diff.supplier_product.wholesale_price;
            }
            const { error } = await (supabase
              .from('supplier_product_mappings') as any)
              .update(updates)
              .eq('id', mapping.id);
            if (error) throw error;
            successCount++;
          }
        } else if (diff.action === 'create') {
          // 開啟指派對話框（逐一處理）
          setAssigningIdx(idx);
          setSelectorOpen(true);
          // 暫停批次處理，等使用者指派
          setApplying(false);
          return;
        } else if (diff.action === 'conflict') {
          // 衝突：更新 mapping
          const mapping = mappings?.find(m => m.vendor_product_id === diff.supplier_product.supplier_sku);
          if (mapping) {
            const updates: Record<string, any> = { updated_at: new Date().toISOString() };
            if (diff.supplier_product.name) updates.vendor_product_name = diff.supplier_product.name;
            if (diff.supplier_product.wholesale_price !== undefined) updates.vendor_unit_cost = diff.supplier_product.wholesale_price;
            const { error } = await (supabase
              .from('supplier_product_mappings') as any)
              .update(updates)
              .eq('id', mapping.id);
            if (error) throw error;
            successCount++;
          }
        }
      } catch (err) {
        console.error('套用失敗:', err);
        errorCount++;
      }
    }

    if (successCount > 0) {
      toast.success(`成功更新 ${successCount} 筆對照關係`);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} 筆更新失敗`);
    }

    // 重新整理
    if (initialProducts) {
      // 重新比對
      setDiffs([]);
      setSelected(new Set());
      setSkippedIndices(new Set());
      // 延遲一下讓 DB 更新完成
      setTimeout(() => processProducts(initialProducts), 500);
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
          setTimeout(() => processProducts(initialProducts), 500);
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

  const filteredDiffs = useMemo(() => {
    return diffs.filter((d, i) => {
      if (skippedIndices.has(i)) return false;
      if (actionFilter !== 'all' && d.action !== actionFilter) return false;
      if (categoryFilter !== 'all' && d.supplier_product.category !== categoryFilter) return false;
      if (changeFieldFilter !== 'all' && !(d.changes || []).some(c => c.field === changeFieldFilter)) return false;
      return true;
    });
  }, [diffs, actionFilter, categoryFilter, changeFieldFilter, skippedIndices]);

  const categories = useMemo(() => {
    const cats = new Set(diffs.map(d => d.supplier_product.category).filter(Boolean));
    return Array.from(cats) as string[];
  }, [diffs]);

  const changeFields = useMemo(() => {
    const fields = new Set<string>();
    diffs.forEach(d => {
      (d.changes || []).forEach(c => fields.add(c.field));
    });
    return Array.from(fields);
  }, [diffs]);

  const handleSelectAll = () => {
    const newSelected = new Set<number>();
    filteredDiffs.forEach((d) => {
      const originalIdx = diffs.indexOf(d);
      if (d.action !== 'unchanged' && !skippedIndices.has(originalIdx)) {
        newSelected.add(originalIdx);
      }
    });
    setSelected(newSelected);
  };

  const handleDeselectAll = () => {
    setSelected(new Set());
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
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
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
              {(['create', 'update', 'unchanged', 'conflict'] as DiffAction[]).map(action => (
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
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              )}
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
                  const allSelected = filteredDiffs.every((d) => {
                    const idx = diffs.indexOf(d);
                    return selected.has(idx);
                  });
                  if (allSelected) {
                    handleDeselectAll();
                  } else {
                    handleSelectAll();
                  }
                }}>
                  {filteredDiffs.every((d) => selected.has(diffs.indexOf(d))) ? '全取消' : '全選'}
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

            <ScrollArea className="h-[400px] w-full rounded-md border">
              <div className="space-y-2 p-3">
                {filteredDiffs.length === 0 && diffs.length > 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    沒有符合篩選條件的項目
                  </div>
                ) : (
                  filteredDiffs.map((diff, idx) => {
                    const originalIdx = diffs.indexOf(diff);
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
                          {diff.action !== 'unchanged' && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelect(originalIdx)}
                              className="mt-1"
                            />
                          )}
                          {diff.action === 'unchanged' && <div className="w-4" />}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className={`gap-1 ${ACTION_BADGE_CLASSES[diff.action]}`}>
                                {ACTION_ICONS[diff.action]}
                                {ACTION_LABELS[diff.action]}
                              </Badge>
                              <span className="font-medium text-sm truncate">
                                {diff.supplier_product.name}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {diff.supplier_product.supplier_sku}
                              </span>
                              {diff.action === 'create' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive ml-auto"
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
            </ScrollArea>

            <DialogFooter className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                已勾選 {selected.size} / {diffs.length - skippedIndices.size} 筆
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { reset(); }}>重新匯入</Button>
                <Button variant="outline" onClick={() => handleClose(false)}>關閉</Button>
                {selected.size > 0 && (
                  <Button onClick={handleApply} disabled={applying}>
                    {applying ? '套用中...' : `套用已勾選 (${selected.size})`}
                  </Button>
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
