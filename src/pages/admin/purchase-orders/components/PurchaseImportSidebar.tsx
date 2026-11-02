import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Link2, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import type { ImportGroup, ImportItemRow, ImportParseResult } from '@/utils/docImport';
import type { ImportMatchResult } from '../importMatchPreview';

export interface PurchaseImportSidebarProps {
  isReturns: boolean;
  unmatchedCodes: { code: string; name: string; count: number }[];
  ambiguousGroups: ImportGroup[];
  ambiguousCodeCount: number;
  groupAmbiguousCodes: (g: ImportGroup) => string[];
  missingCostGroups: ImportGroup[];
  errorGroups: ImportGroup[];
  groupErrors: (g: ImportGroup) => string[];
  parseResult: ImportParseResult | null;
  onAssign?: (item: ImportItemRow) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const STORAGE_KEY = 'po-import-sidebar-open';

export function PurchaseImportSidebar({
  isReturns,
  unmatchedCodes,
  ambiguousGroups,
  ambiguousCodeCount,
  groupAmbiguousCodes,
  missingCostGroups,
  errorGroups,
  groupErrors,
  parseResult,
  onAssign,
  open: controlledOpen,
  onOpenChange,
}: PurchaseImportSidebarProps) {
  const [internalOpen, setInternalOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === '1';
  });
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else {
      setInternalOpen(v);
      try { window.localStorage.setItem(STORAGE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
    }
  };

  if (!open) {
    return (
      <aside className="w-10 shrink-0 flex flex-col items-center gap-2 rounded-lg border bg-muted/20 p-1 text-xs">
        <button
          type="button"
          aria-label="展開側邊欄"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
          onClick={() => setOpen(true)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {unmatchedCodes.length > 0 && (
          <Badge variant="outline" className="border-amber-500 text-amber-700 px-1">{unmatchedCodes.length}</Badge>
        )}
        {errorGroups.length > 0 && (
          <Badge variant="destructive" className="px-1">{errorGroups.length}</Badge>
        )}
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-2 overflow-y-auto rounded-lg border bg-muted/20 p-2 text-xs max-h-[40vh] lg:max-h-none">
      <div className="flex items-center justify-between">
        <span className="font-medium text-muted-foreground">查找說明</span>
        <button
          type="button"
          aria-label="收合側邊欄"
          className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-muted"
          onClick={() => setOpen(false)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {unmatchedCodes.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-2 space-y-1">
          <div className="font-medium text-amber-800">未匹配品項（{unmatchedCodes.length} 個料號）</div>
          <ul className="space-y-0.5 text-amber-800">
            {unmatchedCodes.map((u) => (
              <li key={u.code || `#${u.name}`} className="flex flex-wrap items-center gap-1">
                <span className="font-medium">
                  {u.code || `（無廠商料號）${u.name || '（未命名品項）'}`}
                </span>
                {u.name && u.code && <span className="text-muted-foreground">・{u.name}</span>}
                {u.count > 1 && <span>（共 {u.count} 列）</span>}
                {onAssign && (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center gap-0.5 text-amber-900 underline"
                    onClick={() => onAssign({ name: u.name, vendor_product_name: u.name } as ImportItemRow)}
                  >
                    <Link2 className="h-3 w-3" /> 指定
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">點「品項」欄展開後，按該品項的「指定商品」挑選內部變體。</p>
        </div>
      )}

      {ambiguousGroups.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-2 space-y-1">
          <div className="font-medium text-amber-800">料號歧義（{ambiguousCodeCount} 個料號／{ambiguousGroups.length} 張）</div>
          {ambiguousGroups.map((g) => (
            <div key={g.index} className="text-amber-800">
              <span className="font-medium">第 {g.index + 1} 張（{g.supplier_order_number || '未填單號'}）：</span>
              {groupAmbiguousCodes(g).join('、')}
            </div>
          ))}
          <p className="text-muted-foreground">將依「最近更新的對照」匯入；可於「供應商商品對照」設定主對照。</p>
        </div>
      )}

      {missingCostGroups.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-50 p-2 space-y-1">
          <div className="font-medium text-amber-800">成本未知（{missingCostGroups.length} 張）</div>
          {missingCostGroups.map(g => (
            <span key={g.index} className="mr-2 inline-block">
              第 {g.index + 1} 張（{g.supplier_order_number || '未填單號'}）
            </span>
          ))}
          <p className="text-muted-foreground">未填原採購單且檔案未提供成本；伺服端查不到對照成本時退貨額為 0 元且不沖帳。</p>
        </div>
      )}

      {errorGroups.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1">
          <div className="font-medium text-destructive">需修正（{errorGroups.length} 張）</div>
          {errorGroups.map((g) => (
            <div key={g.index}>
              <span className="font-medium">第 {g.index + 1} 張（{g.supplier_order_number || '未填單號'}）：</span>
              {groupErrors(g).join('；')}
            </div>
          ))}
        </div>
      )}

      {parseResult?.errors.length ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1">
          {parseResult.errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      ) : null}

      <div className="text-muted-foreground space-y-1 pt-1">
        <p>點「品項」欄可展開並直接修正，或新增、刪除品項。</p>
        <p>逐品項判重（供應商＋廠商單號＋商品／變體）由伺服器執行。</p>
        <p>序號／批號數量不符會在伺服端整張回退。</p>
      </div>
    </aside>
  );
}