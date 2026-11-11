import { useMemo, useState, useRef, useEffect } from 'react';
import { useProductCache } from '@/hooks/useProductCache';
import { useSupplierMappings } from '@/pages/admin/purchase-orders/hooks/useSupplierMappings';
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
import { CheckCircle2, Plus, Pencil, AlertTriangle, Minus, ChevronDown, ChevronRight, FileUp, ClipboardPaste, Upload } from 'lucide-react';
import { parseSupplierProductExcel, parseSupplierProductText } from '@/utils/supplierProductParser';
import { matchSupplierProducts, summarizeDiffs } from '@/utils/supplierProductMatcher';
import { SupplierProduct, ProductDiff, DiffAction } from '@/utils/supplierProductSchema';

interface SupplierProductDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 預設供應商名稱（僅顯示用） */
  supplierName?: string;
  /** 供應商 ID，用於查詢 supplier_product_mappings */
  supplierId?: string;
  /** 預先載入的產品資料（如爬蟲結果），開啟時自動比對 */
  initialProducts?: SupplierProduct[];
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
}: SupplierProductDiffDialogProps) {
  const { products } = useProductCache();
  const { mappings } = useSupplierMappings(supplierId);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<SupplierProduct[] | null>(null);
  const [diffs, setDiffs] = useState<ProductDiff[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 重設狀態
  const reset = () => {
    setParsed(null);
    setDiffs([]);
    setSelected(new Set());
    setExpanded(new Set());
    setPastedText('');
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // 解析 + 比對
  const processProducts = (supplierProducts: SupplierProduct[]) => {
    setParsed(supplierProducts);
    const result = matchSupplierProducts(supplierProducts, products as any, mappings);
    setDiffs(result);
    // 預設勾選 create + update + conflict
    const initial = new Set<number>();
    result.forEach((d, i) => {
      if (d.action === 'create' || d.action === 'update' || d.action === 'conflict') {
        initial.add(i);
      }
    });
    setSelected(initial);
  };

  // products 來自 useProductCache()

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

  const summary = useMemo(() => summarizeDiffs(diffs), [diffs]);

  useEffect(() => {
    if (open && initialProducts && initialProducts.length > 0 && diffs.length === 0 && mappings) {
      processProducts(initialProducts);
    }
    if (!open) reset();
  }, [open, initialProducts, mappings]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>供應商產品匯入與比對</DialogTitle>
          <DialogDescription>
            {supplierName ? `供應商：${supplierName}` : '上傳或貼上供應商產品資料，系統將與現有產品比對'}
          </DialogDescription>
        </DialogHeader>

        {diffs.length === 0 ? (
          // 解析階段
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
          // 比對結果階段
          <>
            <div className="flex flex-wrap gap-2 py-2">
              {(['create', 'update', 'unchanged', 'conflict'] as DiffAction[]).map(action => (
                <Badge
                  key={action}
                  variant="outline"
                  className={`gap-1.5 cursor-pointer ${ACTION_BADGE_CLASSES[action]}`}
                  onClick={() => {
                    const indices = diffs.map((d, i) => (d.action === action ? i : -1)).filter(i => i >= 0);
                    const allSelected = indices.every(i => selected.has(i));
                    setSelected(prev => {
                      const next = new Set(prev);
                      if (allSelected) indices.forEach(i => next.delete(i));
                      else indices.forEach(i => next.add(i));
                      return next;
                    });
                  }}
                >
                  {ACTION_ICONS[action]}
                  {ACTION_LABELS[action]} {summary[action]}
                </Badge>
              ))}
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-2 pr-3">
                {diffs.map((diff, idx) => {
                  const isExpanded = expanded.has(idx);
                  const isSelected = selected.has(idx);
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg border p-3 transition-colors ${
                        isSelected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {diff.action !== 'unchanged' && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => {
                              setSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              });
                            }}
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
                          </div>

                          {diff.reason && (
                            <p className="text-xs text-muted-foreground mt-1">{diff.reason}</p>
                          )}

                          {diff.changes && diff.changes.length > 0 && (
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-primary mt-1.5 hover:underline"
                              onClick={() => {
                                setExpanded(prev => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
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
                })}
              </div>
            </ScrollArea>

            <DialogFooter className="flex items-center justify-between gap-2 pt-2">
              <span className="text-xs text-muted-foreground">
                已勾選 {selected.size} / {diffs.length} 筆
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { reset(); }}>重新匯入</Button>
                <Button variant="outline" onClick={() => handleClose(false)}>關閉</Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
