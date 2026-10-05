import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Upload, FileDown, ClipboardPaste, FileUp, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import {
  DocImportKind,
  ImportGroup,
  ImportParseResult,
  ImportDateIssue,
  IMPORT_QUERY_KEYS,
  IMPORT_RPC_NAMES,
  downloadImportTemplate,
  importGroupPayload,
  parseImportExcel,
  parseImportText,
  rowsToImportGroups,
} from '@/utils/docImport';

interface DocImportDialogProps {
  kind: DocImportKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

interface ImportRpcResult {
  total: number;
  success: number;
  results: Array<Record<string, unknown>>;
  errors: Array<{ index: number; reason: string }>;
}

const KIND_LABELS: Record<DocImportKind, string> = {
  orders: '訂單',
  sales: '銷貨單',
  consignment: '寄賣單',
  purchase: '採購單',
};

const RESULT_CODE_FIELD: Record<DocImportKind, string> = {
  orders: 'order_code',
  sales: 'sales_code',
  consignment: 'consignment_code',
  purchase: 'supplier_order_number',
};

const DATE_ISSUE_LABELS: Record<ImportDateIssue['field'], string> = {
  order_date: '單據日期',
  expected_date: '預計到貨日',
  shipped_date: '出貨日期',
};

// 本對話框沒有日期選擇器，故日期無法辨識一律視為錯誤擋下（不可靜默帶入今天／空值）
function errorsOf(g: ImportGroup): string[] {
  const errs = [...g.errors];
  for (const issue of g.dateIssues ?? []) {
    const label = DATE_ISSUE_LABELS[issue.field];
    errs.push(`第 ${issue.row + 1} 列${label}「${issue.raw}」無法辨識，請於檔案中修正後重新上傳`);
  }
  return errs;
}

export function DocImportDialog({ kind, open, onOpenChange, onImported }: DocImportDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ImportRpcResult | null>(null);

  const groups: ImportGroup[] = useMemo(
    () => (parseResult ? rowsToImportGroups(kind, parseResult.rows) : []),
    [parseResult, kind],
  );
  const hasValidationError = groups.some((g) => errorsOf(g).length > 0);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  const reset = () => {
    setPastedText('');
    setParseResult(null);
    setFileName('');
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
  };

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>[]) => {
      const { data, error } = await (supabase.rpc as any)(IMPORT_RPC_NAMES[kind], { p_rows: payload });
      if (error) throw error;
      return data as ImportRpcResult;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.success > 0) {
        toast.success(`匯入完成：成功 ${data.success} / 共 ${data.total} 筆`, {
          description: data.errors.length
            ? `${data.errors.length} 筆失敗（請見下方明細）`
            : '全部匯入成功',
        });
        queryClient.invalidateQueries({ queryKey: IMPORT_QUERY_KEYS[kind] });
        onImported?.();
      } else if (data.total === 0) {
        toast.error('沒有可匯入的資料');
      } else {
        toast.error('匯入失敗：全部資料皆未匯入', {
          description: '請檢查下方錯誤明細後修正再試。',
        });
      }
    },
    onError: (error: unknown) => {
      toast.error('匯入失敗', { description: error instanceof Error ? error.message : String(error) });
    },
  });

  const codeField = RESULT_CODE_FIELD[kind];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            匯入{KIND_LABELS[kind]}
          </DialogTitle>
          <DialogDescription>
            上傳 Excel／CSV 或貼上內容，依「單號欄」分組後批次建立。銷貨單會自動建立來源訂單並扣自有倉庫庫存；寄賣單（寄出、已出貨）會自動建立來源訂單避免孤兒；廠商進貨方向寫入供應商寄賣倉庫存。
          </DialogDescription>
        </DialogHeader>

        {!parseResult ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => downloadImportTemplate(kind)}>
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
                <div className="text-xs text-muted-foreground">第一列需為欄位名稱（店家代碼／訂單編號／SKU／數量…），用「單號欄」將同單號的多列分為同一單據。</div>
              </TabsContent>
              <TabsContent value="paste" className="space-y-2">
                <Textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={'店家代碼\t訂單編號\tSKU\t數量\t單價\n\tttshop001\tOD26090100001\tGLA_AP-HC-IP13-MINI\t2\t1200'}
                  className="min-h-[160px] font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">支援 Tab／逗號分隔。各欄貼上後按「解析預覽」。</p>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                取消
              </Button>
              {activeTab === 'paste' && (
                <Button
                  onClick={async () => {
                    setParseResult(await parseImportText(pastedText, '貼上內容'));
                  }}
                  disabled={!pastedText.trim()}
                >
                  解析預覽
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground shrink-0">
              <Badge variant="outline">{fileName || '貼上內容'}</Badge>
              <span>共 <strong>{groups.length}</strong> 組單據</span>
              <span>・</span>
              <span>品項 <strong>{totalItems}</strong> 列</span>
              {parseResult.errors.length > 0 && (
                <Badge variant="destructive">解析錯誤 {parseResult.errors.length}</Badge>
              )}
              {hasValidationError && <Badge variant="destructive">需修正 {groups.filter(g => errorsOf(g).length).length} 組</Badge>}
            </div>

            {parseResult.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive space-y-1 shrink-0">
                {parseResult.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}

            <ScrollArea className="flex-1 min-h-0 rounded-lg border">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Inbox className="h-8 w-8" />
                  <p className="text-sm">沒有解析到任何資料列</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left px-3 py-2 font-medium">#</th>
                      <th className="text-left px-3 py-2 font-medium">單號</th>
                      <th className="text-left px-3 py-2 font-medium">店家</th>
                      <th className="text-left px-3 py-2 font-medium">日期</th>
                      <th className="text-left px-3 py-2 font-medium">品項</th>
                      <th className="text-left px-3 py-2 font-medium">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groups.map((g) => {
                      const gErrors = errorsOf(g);
                      return (
                      <tr key={g.index} className={gErrors.length ? 'bg-destructive/5' : ''}>
                        <td className="px-3 py-2 text-muted-foreground">{g.index + 1}</td>
                        <td className="px-3 py-2 font-medium">{g[codeField] || '自動生成'}</td>
                        <td className="px-3 py-2">{g.store_code || g.supplier_code || '-'}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {kind === 'orders' ? g.order_date : g.shipped_date || '-'}
                        </td>
                        <td className="px-3 py-2">{g.items.length} 列</td>
                        <td className="px-3 py-2">
                          {gErrors.length ? (
                            <span className="flex items-center gap-1 text-destructive text-xs">
                              <AlertTriangle className="h-3.5 w-3.5" /> {gErrors.length} 個錯誤
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

            {groups.filter((g) => errorsOf(g).length > 0).length > 0 && (
              <div className="rounded-lg border p-2 text-xs space-y-1 shrink-0 max-h-40 overflow-y-auto">
                {groups.filter((g) => errorsOf(g).length > 0).map((g) => (
                  <div key={g.index}>
                    <span className="font-medium">第 {g.index + 1} 組（{g[codeField] || '自動生成'}）：</span>
                    {errorsOf(g).join('；')}
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div className="rounded-lg border p-2 text-xs space-y-1 shrink-0">
                {result.errors.map((e) => (
                  <div key={e.index} className="text-destructive">
                    第 {e.index + 1} 組失敗：{e.reason}
                  </div>
                ))}
                {result.results.map((r) => (
                  <div key={String(r.index)} className={result.errors.some(e => e.index === r.index) ? 'text-destructive' : 'text-emerald-700'}>
                    第 {String(r.index)} 組 → {String(r[codeField] || r.consignment_code || r.sales_code || r.order_code || '(待生成)')}（{String(r.item_count)} 品項）
                  </div>
                ))}
              </div>
            )}

            <DialogFooter className="shrink-0">
              <Button variant="outline" onClick={reset}>
                重新選擇
              </Button>
              <Button
                variant="outline"
                onClick={() => downloadImportTemplate(kind)}
              >
                <FileDown className="h-4 w-4 mr-1.5" /> 範本
              </Button>
              <Button
                onClick={() => mutation.mutate(importGroupPayload(kind, groups))}
                disabled={mutation.isPending || groups.length === 0}
              >
                {mutation.isPending ? '匯入中...' : `確認匯入 ${groups.length} 組`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}