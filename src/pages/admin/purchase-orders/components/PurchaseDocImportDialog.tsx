import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useWarehouses } from '@/pages/admin/inventory/hooks/useWarehouses';
import {
  ClipboardPaste, FileDown, FileUp, Inbox, Upload, AlertTriangle, CheckCircle2, SkipForward, Loader2,
} from 'lucide-react';
import {
  ImportGroup, ImportParseResult, IMPORT_QUERY_KEYS, downloadImportTemplate,
  importGroupPayload, parseImportExcel, parseImportText, rowsToImportGroups,
} from '@/utils/docImport';
import { getErrorMessage } from '@/lib/errorMessages';
import { PoImportBatchArgs, PoImportGroupPayload, PoImportResult, Supplier } from '../types';

interface PurchaseDocImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  defaultSupplierId?: string;
  onImported?: () => void;
}

type View = 'setup' | 'preview' | 'result';

interface GroupEdit {
  status: string;
  purpose: string;
  receive: boolean;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿（draft）' },
  { value: 'ordered', label: '已下單（ordered）' },
  { value: 'cancelled', label: '已取消（cancelled）' },
];

const PURPOSE_OPTIONS = [
  { value: 'general', label: '一般進貨' },
  { value: 'repair_parts', label: '維修叫料' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  ordered: '已下單',
  cancelled: '已取消',
};

export function PurchaseDocImportDialog({
  open, onOpenChange, suppliers, defaultSupplierId, onImported,
}: PurchaseDocImportDialogProps) {
  const queryClient = useQueryClient();
  const { warehouses, defaultWarehouse } = useWarehouses();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [view, setView] = useState<View>('setup');
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  // 頁面篩選的 sentinel（'all'）不是真實供應商 id，須排除否則會帶進群組錯誤
  const initialSupplierId = defaultSupplierId && defaultSupplierId !== 'all' ? defaultSupplierId : '';
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [warehouseId, setWarehouseId] = useState('');
  const [edits, setEdits] = useState<Record<number, GroupEdit>>({});
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<PoImportResult | null>(null);

  // 開啟時以目前頁面篩選的供應商預帶（避免 mount 時快照過期）
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) setSupplierId(initialSupplierId);
    wasOpenRef.current = open;
  }, [open, initialSupplierId]);

  const ownWarehouse = warehouses.find(w => w.code === 'own');
  const effectiveWarehouseId = warehouseId || ownWarehouse?.id || defaultWarehouse?.id || '';
  const supplier = suppliers.find(s => s.id === supplierId);

  const groups: ImportGroup[] = useMemo(
    () => (parseResult ? rowsToImportGroups('purchase', parseResult.rows) : []),
    [parseResult],
  );

  // 供應商一致性：檔案「供應商」欄有值時必須與所選供應商相符（RPC 僅接受單一供應商）
  const supplierMismatch = useMemo(() => {
    const map = new Map<number, boolean>();
    if (!supplier) return map;
    const target = supplier.name.trim().toLowerCase();
    for (const g of groups) {
      const code = g.supplier_code?.trim().toLowerCase();
      map.set(g.index, !!code && code !== target);
    }
    return map;
  }, [groups, supplier]);

  const poNumbers = useMemo(
    () => Array.from(new Set(groups.map(g => g.supplier_order_number).filter((n): n is string => !!n))),
    [groups],
  );

  // 軟性提醒：此廠商單號已存在於幾張未取消的採購單（權威的逐品項判重仍由 RPC 執行）
  const { data: existingPoCount = new Map<string, number>() } = useQuery({
    queryKey: ['po-import-existing', supplierId, poNumbers.join('|')],
    enabled: !!supplierId && poNumbers.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('purchase_orders')
        .select('id, supplier_order_number')
        .eq('supplier_id', supplierId)
        .in('supplier_order_number', poNumbers)
        .neq('status', 'cancelled');
      if (error) throw error;
      const map = new Map<string, number>();
      for (const po of (data || []) as Array<{ supplier_order_number: string | null }>) {
        if (!po.supplier_order_number) continue;
        map.set(po.supplier_order_number, (map.get(po.supplier_order_number) || 0) + 1);
      }
      return map;
    },
  });

  const editOf = (g: ImportGroup): GroupEdit => edits[g.index] ?? {
    status: (g.status || 'draft').toLowerCase(),
    purpose: (g.purpose || 'general').toLowerCase(),
    receive: g.receive ?? false,
  };

  // 以「該群組目前的有效值」為基底，避免第一次改單一欄位時把其他欄位重設成 draft/general/false
  const patchEdit = (index: number, patch: Partial<GroupEdit>) => {
    setEdits((prev) => {
      const group = groups.find((g) => g.index === index);
      const base: GroupEdit = prev[index] ?? {
        status: (group?.status || 'draft').toLowerCase() as GroupEdit['status'],
        purpose: (group?.purpose || 'general').toLowerCase() as GroupEdit['purpose'],
        receive: group?.receive ?? false,
      };
      return { ...prev, [index]: { ...base, ...patch } };
    });
  };

  const groupErrors = (g: ImportGroup): string[] => {
    const errs = [...g.errors];
    if (!supplierId) errs.push('請先選擇供應商');
    if (supplierMismatch.get(g.index)) {
      errs.push(`檔案供應商「${g.supplier_code}」與所選供應商「${supplier?.name}」不符`);
    }
    return errs;
  };

  const errorGroups = groups.filter(g => groupErrors(g).length > 0);
  const selectedGroups = groups.filter(g => !excluded[g.index] && groupErrors(g).length === 0);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
  const totalQuantity = groups.reduce(
    (sum, g) => sum + g.items.reduce((s, i) => s + (i.quantity || 0), 0),
    0,
  );

  const reset = () => {
    setView('setup');
    setActiveTab('upload');
    setPastedText('');
    setParseResult(null);
    setFileName('');
    setEdits({});
    setExcluded({});
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (file: File) => {
    const isCsv = /\.csv$/i.test(file.name);
    const buffer = await file.arrayBuffer();
    setFileName(file.name);
    if (isCsv) {
      const text = new TextDecoder('utf-8').decode(buffer);
      setParseResult(await parseImportText(text, file.name));
    } else {
      setParseResult(await parseImportExcel(buffer));
    }
    setView('preview');
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = importGroupPayload(
        'purchase',
        selectedGroups.map((g) => {
          const edit = editOf(g);
          return {
            ...g,
            status: edit.status,
            purpose: edit.purpose,
            receive: edit.receive,
          };
        }),
      ) as unknown as PoImportGroupPayload[];
      const args: PoImportBatchArgs = {
        p_supplier_id: supplierId,
        p_groups: payload,
        p_warehouse_id: effectiveWarehouseId || null,
        p_created_by: null,
      };
      const { data, error } = await supabase.rpc(
        'import_purchase_orders_batch',
        args as unknown as Database['public']['Functions']['import_purchase_orders_batch']['Args'],
      );
      if (error) throw error;
      return data as unknown as PoImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setView('result');
      if (data.success > 0) {
        const skipped = data.results.filter(r => r.status === 'skipped').length;
        toast.success(`匯入完成：建立 ${data.success} / 共 ${data.total} 張`, {
          description: data.errors.length || skipped
            ? `${data.errors.length} 張失敗、${skipped} 張全部品項已存在而略過（請見下方明細）`
            : '全部匯入成功',
        });
        for (const key of IMPORT_QUERY_KEYS.purchase) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
        queryClient.invalidateQueries({ queryKey: ['receiving-orders'] });
        onImported?.();
      } else if (data.total === 0) {
        toast.error('沒有可匯入的資料');
        setView('preview');
      } else {
        toast.error('匯入失敗：沒有任何一張建立成功', {
          description: '請檢查下方錯誤明細後修正再試。',
        });
      }
    },
    onError: (error: unknown) => {
      toast.error('匯入失敗', { description: getErrorMessage(error) });
    },
  });

  const canSubmit = selectedGroups.length > 0 && !!supplierId && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            匯入採購單
          </DialogTitle>
          <DialogDescription>
            上傳 Excel／CSV 或貼上內容，依「廠商單號」分組後批次建立。同一供應商＋廠商單號＋商品的重複品項會自動略過；
            勾「立即收貨」且狀態為已下單時，會於建立後直接入庫（序號／批號商品請填「序號」「批號」欄位，缺漏將回退整張單）。
          </DialogDescription>
        </DialogHeader>

        {view === 'setup' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">供應商（必填）</span>
                <Select value={supplierId || 'none'} onValueChange={(v) => setSupplierId(v === 'none' ? '' : v)}>
                  <SelectTrigger aria-label="供應商">
                    <SelectValue placeholder="請選擇供應商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">請選擇供應商</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">收貨倉庫（立即收貨時使用）</span>
                <Select
                  value={effectiveWarehouseId || 'none'}
                  onValueChange={(v) => setWarehouseId(v === 'none' ? '' : v)}
                >
                  <SelectTrigger aria-label="收貨倉庫">
                    <SelectValue placeholder="預設自有倉" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">預設（自有倉）</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadImportTemplate('purchase')}>
                <FileDown className="h-4 w-4 mr-1.5" /> 下載範本
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'upload' | 'paste')}>
              <TabsList>
                <TabsTrigger value="upload">
                  <Upload className="h-4 w-4 mr-1.5" /> 上傳檔案
                </TabsTrigger>
                <TabsTrigger value="paste">
                  <ClipboardPaste className="h-4 w-4 mr-1.5" /> 貼上內容
                </TabsTrigger>
              </TabsList>
              <TabsContent value="upload" className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  className="w-full h-24 flex-col gap-2 text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6" />
                  點擊選擇 Excel（.xlsx）或 CSV 檔案
                </Button>
                <div className="text-xs text-muted-foreground">
                  第一列需為欄位名稱（廠商單號／採購日期／SKU／數量／成本…），用「廠商單號」將同單號的多列分為同一張採購單。
                  同一廠商單號的多列會合併成一張單，單號以外的欄位（日期／狀態／類型／備註）取該單號第一列的值，品項欄則逐列累加。
                </div>
              </TabsContent>
              <TabsContent value="paste" className="space-y-2">
                <Textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={'廠商單號\t採購日期\t狀態\tSKU\t數量\t成本\nPO-20260901-01\t2026-09-01\tordered\tGLA_AP-HC-IP13-MINI\t2\t600'}
                  className="min-h-[160px] font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">支援 Tab／逗號分隔。各欄貼上後按「解析預覽」。</p>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>取消</Button>
              {activeTab === 'paste' && (
                <Button
                  onClick={async () => {
                    setParseResult(await parseImportText(pastedText, '貼上內容'));
                    setView('preview');
                  }}
                  disabled={!pastedText.trim()}
                >
                  解析預覽
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : view === 'preview' ? (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground shrink-0">
              <Badge variant="outline">{fileName || '貼上內容'}</Badge>
              <span>共 <strong>{groups.length}</strong> 張</span>
              <span>・</span>
              <span>品項 <strong>{totalItems}</strong> 列（{totalQuantity} 件）</span>
              {selectedGroups.length !== groups.length && (
                <Badge variant="secondary">將匯入 {selectedGroups.length} 張</Badge>
              )}
              {errorGroups.length > 0 && (
                <Badge variant="destructive">需修正 {errorGroups.length} 張</Badge>
              )}
            </div>

            {parseResult?.errors.length ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive space-y-1 shrink-0">
                {parseResult.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            ) : null}

            <ScrollArea className="flex-1 min-h-0 rounded-lg border">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Inbox className="h-8 w-8" />
                  <p className="text-sm">沒有解析到任何資料列</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b">
                      <th className="text-left px-3 py-2 font-medium w-10">匯入</th>
                      <th className="text-left px-3 py-2 font-medium">廠商單號</th>
                      <th className="text-left px-3 py-2 font-medium">採購日期</th>
                      <th className="text-left px-3 py-2 font-medium">預計到貨</th>
                      <th className="text-left px-3 py-2 font-medium">狀態</th>
                      <th className="text-left px-3 py-2 font-medium">類型</th>
                      <th className="text-left px-3 py-2 font-medium">立即收貨</th>
                      <th className="text-left px-3 py-2 font-medium">品項</th>
                      <th className="text-left px-3 py-2 font-medium">檢查</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groups.map((g) => {
                      const edit = editOf(g);
                      const errs = groupErrors(g);
                      const isExcluded = !!excluded[g.index];
                      const existingCount = g.supplier_order_number
                        ? existingPoCount.get(g.supplier_order_number) || 0
                        : 0;
                      return (
                        <tr key={g.index} className={errs.length ? 'bg-destructive/5' : ''}>
                          <td className="px-3 py-2">
                            <Checkbox
                              aria-label={`匯入第 ${g.index + 1} 張採購單`}
                              checked={!isExcluded && errs.length === 0}
                              disabled={errs.length > 0}
                              onCheckedChange={(v) => setExcluded((prev) => ({ ...prev, [g.index]: v !== true }))}
                            />
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {g.supplier_order_number || <span className="text-muted-foreground">未填（不判重）</span>}
                            {existingCount > 0 && (
                              <Badge variant="outline" className="ml-2">已存在 {existingCount} 張</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{g.order_date || '今天'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{g.expected_date || '-'}</td>
                          <td className="px-3 py-2">
                            <Select
                              value={edit.status}
                              onValueChange={(v) => patchEdit(g.index, { status: v })}
                            >
                              <SelectTrigger className="h-8 w-32" aria-label="狀態">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Select
                              value={edit.purpose}
                              onValueChange={(v) => patchEdit(g.index, { purpose: v })}
                            >
                              <SelectTrigger className="h-8 w-28" aria-label="類型">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PURPOSE_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Checkbox
                              aria-label={`第 ${g.index + 1} 張立即收貨`}
                              checked={edit.receive}
                              onCheckedChange={(v) => patchEdit(g.index, { receive: v === true })}
                            />
                          </td>
                          <td className="px-3 py-2">{g.items.length} 列</td>
                          <td className="px-3 py-2">
                            {errs.length ? (
                              <span className="flex items-start gap-1 text-destructive text-xs">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errs[0]}
                                {errs.length > 1 && <span className="text-muted-foreground">等 {errs.length} 項</span>}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-emerald-600 text-xs">
                                <CheckCircle2 className="h-3.5 w-3.5" /> 就緒
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </ScrollArea>

            {errorGroups.length > 0 && (
              <div className="rounded-lg border p-2 text-xs space-y-1 shrink-0 max-h-32 overflow-y-auto">
                {errorGroups.map((g) => (
                  <div key={g.index}>
                    <span className="font-medium">第 {g.index + 1} 張（{g.supplier_order_number || '未填單號'}）：</span>
                    {groupErrors(g).join('；')}
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground shrink-0">
              逐品項判重（供應商＋廠商單號＋商品／變體）由伺服器執行，重複品項不會重複建立，將於結果畫面列出「略過」明細。
              序號／批號數量不符會在伺服端整張回退。
            </div>

            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => { setView('setup'); setParseResult(null); }}>
                重新選擇
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadImportTemplate('purchase')}
              >
                <FileDown className="h-4 w-4 mr-1.5" /> 範本
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
                {mutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> 建立中…</>
                  : `確認建立 ${selectedGroups.length} 張`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm shrink-0">
              <Badge variant="outline">共 {result?.total ?? 0} 張</Badge>
              <Badge variant="outline">成功 {result?.success ?? 0}</Badge>
              <Badge variant={result?.results.filter(r => r.status === 'skipped').length ? 'secondary' : 'outline'}>
                略過 {result?.results.filter(r => r.status === 'skipped').length ?? 0}
              </Badge>
              <Badge variant={result?.errors.length ? 'destructive' : 'outline'}>
                失敗 {result?.errors.length ?? 0}
              </Badge>
            </div>

            <ScrollArea className="flex-1 min-h-0 rounded-lg border">
              <div className="p-3 space-y-2 text-sm">
                {(result?.errors ?? []).map((e) => (
                  <div key={`err-${e.index}`} className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                    <div className="flex items-center gap-1.5 text-destructive text-xs font-medium">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      第 {e.index + 1} 張失敗（{e.supplier_order_number || '未填單號'}）
                    </div>
                    <p className="mt-1 text-xs">{e.reason}</p>
                  </div>
                ))}

                {(result?.results ?? []).map((r) => (
                  <div
                    key={`res-${r.index}`}
                    className={`rounded-md border p-2 ${r.status === 'created' ? 'border-emerald-300 bg-emerald-50' : 'bg-muted/40'}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {r.status === 'created'
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        : <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="font-medium">
                        第 {r.index + 1} 張{r.status === 'created' ? '已建立' : '已略過'}
                        {r.supplier_order_number ? `（${r.supplier_order_number}）` : '（未填單號）'}
                      </span>
                      {r.received && <Badge variant="outline">已收貨入庫</Badge>}
                      {r.status === 'skipped' && r.reason && (
                        <span className="text-xs text-muted-foreground">{r.reason}</span>
                      )}
                    </div>
                    {r.created_items && r.created_items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {r.created_items.map((it, i) => (
                          <li key={`c-${i}`} className="text-emerald-700">＋ {it.name} × {it.quantity}</li>
                        ))}
                      </ul>
                    )}
                    {r.skipped_items && r.skipped_items.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {r.skipped_items.map((it, i) => (
                          <li key={`s-${i}`} className="text-muted-foreground line-through">－ {it.name} × {it.quantity}（已存在）</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}

                {result?.total === 0 && (
                  <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                    <Inbox className="h-8 w-8" />
                    <p className="text-sm">沒有可匯入的資料</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={() => setView('setup')}>繼續匯入</Button>
              <Button onClick={() => handleClose(false)}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
