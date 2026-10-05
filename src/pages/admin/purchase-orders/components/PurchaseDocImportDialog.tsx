import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useWarehouses } from '@/pages/admin/inventory/hooks/useWarehouses';
import {
  ClipboardPaste, FileDown, FileUp, Inbox, Upload, AlertTriangle, CheckCircle2, SkipForward, Loader2,
  CalendarIcon, X, Plus, Trash2, Undo2, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  ImportGroup, ImportItemRow, ImportParseResult, ImportDateIssue, IMPORT_QUERY_KEYS, downloadImportTemplate,
  importGroupPayload, parseImportExcel, parseImportText, rowsToImportGroups,
} from '@/utils/docImport';
import { getErrorMessage } from '@/lib/errorMessages';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
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
  /** 僅記錄「使用者手動覆寫」；undefined 代表沿用檔案解析值 */
  orderDate?: string;
  expectedDate?: string;
  shippedDate?: string;
}

const DATE_ISSUE_LABELS: Record<ImportDateIssue['field'], string> = {
  order_date: '採購日期',
  expected_date: '預計到貨日',
  shipped_date: '出貨日期',
};

const DATE_OVERRIDE_KEY: Record<ImportDateIssue['field'], keyof GroupEdit> = {
  order_date: 'orderDate',
  expected_date: 'expectedDate',
  shipped_date: 'shippedDate',
};

/** 本對話框可手動選取的日期欄（其餘欄位的問題需回檔案修正） */
const EDITABLE_DATE_FIELDS: ImportDateIssue['field'][] = ['order_date', 'expected_date'];

/** '2026-09-01' → 本地 Date。不可用 new Date('2026-09-01')（UTC midnight，負時區會退一天） */
function parseIsoLocal(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 預覽表的日期欄：可點擊手動選日期；解析失敗時顯示原始值並標紅 */
function ImportDateCell({
  value, raw, invalid, placeholder, ariaLabel, onChange, onReset,
}: {
  value?: string;
  raw?: string;
  invalid?: boolean;
  placeholder: string;
  ariaLabel: string;
  onChange: (next: string) => void;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={ariaLabel}
            className={cn(
              'h-8 w-[136px] justify-start px-2 font-normal',
              !value && 'text-muted-foreground',
              invalid && 'border-destructive text-destructive',
            )}
          >
            <CalendarIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{value ?? (invalid ? raw || '無法辨識' : placeholder)}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseIsoLocal(value)}
            onSelect={(d) => {
              if (!d) return;
              onChange(format(d, 'yyyy-MM-dd'));
              setOpen(false);
            }}
            locale={zhTW}
          />
        </PopoverContent>
      </Popover>
      {onReset && value && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={`還原${ariaLabel}為檔案值`}
          onClick={onReset}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

interface ImportItemsEditorProps {
  groupLabel: string;
  items: ImportItemRow[];
  /** 使用者是否已就地修改（決定「還原檔案值」是否可用） */
  dirty: boolean;
  onPatch: (itemIndex: number, patch: Partial<ImportItemRow>) => void;
  onRemove: (itemIndex: number) => void;
  onAdd: () => void;
  onReset: () => void;
}

/**
 * 展開後的品項編輯區。可直接改品名／廠商料號／SKU／數量／單價，並新增或刪除品項。
 * 逐列即時顯示檢核訊息與小計，讓「檔案格式不符」可在預覽階段就修好，不必來回重新上傳。
 */
function ImportItemsEditor({
  groupLabel, items, dirty, onPatch, onRemove, onAdd, onReset,
}: ImportItemsEditorProps) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">{groupLabel}</span>
        <div className="flex items-center gap-1">
          {dirty && (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onReset}>
              <Undo2 className="h-3 w-3 mr-1" /> 還原檔案值
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onAdd}>
            <Plus className="h-3 w-3 mr-1" /> 新增品項
          </Button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            <th className="text-left px-1.5 py-1 font-medium w-8">#</th>
            <th className="text-left px-1.5 py-1 font-medium">品名</th>
            <th className="text-left px-1.5 py-1 font-medium">廠商料號</th>
            <th className="text-left px-1.5 py-1 font-medium">SKU</th>
            <th className="text-left px-1.5 py-1 font-medium w-20">數量</th>
            <th className="text-left px-1.5 py-1 font-medium w-24">單價</th>
            <th className="text-right px-1.5 py-1 font-medium w-24">小計</th>
            <th className="w-9" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const errs = itemErrors(item, i);
            return (
              <tr key={i} className={errs.length ? 'bg-destructive/5' : ''}>
                <td className="px-1.5 py-1 align-top text-muted-foreground">{i + 1}</td>
                <td className="px-1.5 py-1 align-top">
                  <Input
                    value={item.name ?? ''}
                    placeholder="品名"
                    aria-label={`${groupLabel} 第 ${i + 1} 個品項 品名`}
                    className="h-7 text-xs"
                    onChange={(e) => onPatch(i, { name: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1 align-top">
                  <Input
                    value={item.vendor_product_id ?? ''}
                    placeholder="廠商料號"
                    aria-label={`${groupLabel} 第 ${i + 1} 個品項 廠商料號`}
                    className="h-7 text-xs"
                    onChange={(e) => onPatch(i, { vendor_product_id: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1 align-top">
                  <Input
                    value={item.sku ?? ''}
                    placeholder="SKU"
                    aria-label={`${groupLabel} 第 ${i + 1} 個品項 SKU`}
                    className="h-7 text-xs"
                    onChange={(e) => onPatch(i, { sku: e.target.value })}
                  />
                </td>
                <td className="px-1.5 py-1 align-top">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={item.quantity ?? ''}
                    placeholder="數量"
                    aria-label={`${groupLabel} 第 ${i + 1} 個品項 數量`}
                    className="h-7 text-xs"
                    onChange={(e) => onPatch(i, { quantity: toIntOrUndef(e.target.value) })}
                  />
                </td>
                <td className="px-1.5 py-1 align-top">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={item.unit_cost ?? ''}
                    placeholder="單價"
                    aria-label={`${groupLabel} 第 ${i + 1} 個品項 單價`}
                    className="h-7 text-xs"
                    onChange={(e) => onPatch(i, { unit_cost: toNumberOrUndef(e.target.value) })}
                  />
                </td>
                <td className="px-1.5 py-1 align-top text-right tabular-nums">
                  {formatCurrency(itemAmount(item))}
                </td>
                <td className="px-1 py-1 align-top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    aria-label={`刪除${groupLabel}第 ${i + 1} 個品項（${itemLabel(item)}）`}
                    onClick={() => onRemove(i)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t">
            <td colSpan={6} className="px-1.5 py-1 text-right font-medium">合計</td>
            <td className="px-1.5 py-1 text-right tabular-nums font-medium">
              {formatCurrency(groupAmount(items))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {items.some((it, i) => itemErrors(it, i).length > 0) && (
        <ul className="mt-1.5 space-y-0.5 text-destructive">
          {items.flatMap((it, i) => itemErrors(it, i).map((e) => <li key={i}>・{e}</li>))}
        </ul>
      )}
    </div>
  );
}

/** 空字串視為「未填」（undefined），避免空欄位被當成 0 或 NaN 送出 */
function toNumberOrUndef(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toIntOrUndef(value: string): number | undefined {
  const n = toNumberOrUndef(value);
  return n === undefined ? undefined : Math.trunc(n);
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

type MappingCodeStat = { total: number; primaryCount: number };

// 與伺服端 _po_resolve_item 的 ambiguous 定義一致：同料號多筆對照且無主對照。
// 伺服端此時仍會依「最近更新的對照」決定性選一筆（非錯誤），故前端僅提示。
function ambiguousCodesOf(
  items: ImportItemRow[],
  stats: Map<string, MappingCodeStat>,
): string[] {
  const hits = new Set<string>();
  for (const it of items) {
    const code = it.vendor_product_id?.trim();
    if (!code) continue;
    const stat = stats.get(code);
    if (stat && stat.total > 1 && stat.primaryCount === 0) hits.add(code);
  }
  return Array.from(hits);
}

/** 單一品項小計 = 數量 × 單價（缺值視為 0，避免 NaN 顯示於表格） */
function itemAmount(item: ImportItemRow): number {
  return (item.quantity || 0) * (item.unit_cost || 0);
}

function groupAmount(items: ImportItemRow[]): number {
  return items.reduce((sum, it) => sum + itemAmount(it), 0);
}

/**
 * 逐品項檢查（建立前可修正）。供應商欄已由群組層檢查，此處只管品項自身的可匯入性。
 * 至少要有 SKU／廠商料號／品名之一，否則伺服端無法解析商品。
 */
function itemErrors(item: ImportItemRow, rowIndex: number): string[] {
  const errs: string[] = [];
  const label = item.vendor_product_id?.trim() || item.sku?.trim() || item.name?.trim();
  if (!label) errs.push(`第 ${rowIndex + 1} 個品項未填 SKU／廠商料號／品名，無法對應商品`);
  const qty = item.quantity;
  if (qty === undefined || qty === null || !Number.isFinite(qty)) {
    errs.push(`「${label ?? rowIndex + 1}」缺少數量`);
  } else if (!Number.isInteger(qty)) {
    errs.push(`「${label ?? rowIndex + 1}」數量 ${qty} 必須是整數`);
  } else if (qty <= 0) {
    errs.push(`「${label ?? rowIndex + 1}」數量必須大於 0`);
  }
  const cost = item.unit_cost;
  if (cost !== undefined && cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    errs.push(`「${label ?? rowIndex + 1}」單價不可為負數`);
  }
  return errs;
}

function itemLabel(item: ImportItemRow): string {
  return item.vendor_product_id?.trim() || item.sku?.trim() || item.name?.trim() || '（未命名品項）';
}

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
  /** 品項就地修正（key 為群組 index）；未建立紀錄者沿用檔案解析值 */
  const [itemEdits, setItemEdits] = useState<Record<number, ImportItemRow[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
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

  // 該群組目前的有效品項（已套用使用者就地修正）。宣告須早於所有 useMemo 呼叫端，
  // 否則 useMemo factory 在 render 期間執行時會撞到 const 的 TDZ。
  const itemsOf = useCallback(
    (g: ImportGroup): ImportItemRow[] => itemEdits[g.index] ?? g.items,
    [itemEdits],
  );

  // 料號歧義預覽：同料號在對照表有多筆、且沒有主對照時，伺服端會依「最近更新」決定性
  // 選一筆（非錯誤）。此處以相同定義於前端提示，避免使用者事後才發現品項不是預期的商品。
  // 對照以 (supplier_id, vendor_product_id) 比對，故以廠商料號查詢並於客戶端過濾檔案中的料號。
  const importCodes = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const it of itemsOf(g)) {
        const code = it.vendor_product_id?.trim();
        if (code) set.add(code);
      }
    }
    return Array.from(set);
  }, [groups, itemsOf]);

  const { data: mappingCodeStats = new Map<string, MappingCodeStat>() } = useQuery({
    queryKey: ['po-import-mapping-codes', supplierId],
    enabled: !!supplierId && importCodes.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('supplier_product_mappings')
        .select('vendor_product_id, is_primary')
        .eq('supplier_id', supplierId);
      if (error) throw error;
      const wanted = new Set(importCodes);
      const map = new Map<string, MappingCodeStat>();
      for (const row of (data || []) as Array<{ vendor_product_id: string | null; is_primary: boolean | null }>) {
        const code = row.vendor_product_id?.trim();
        if (!code || !wanted.has(code)) continue;
        const cur = map.get(code) ?? { total: 0, primaryCount: 0 };
        cur.total += 1;
        if (row.is_primary) cur.primaryCount += 1;
        map.set(code, cur);
      }
      return map;
    },
  });

  const editOf = (g: ImportGroup): GroupEdit => edits[g.index] ?? {
    status: (g.status || 'draft').toLowerCase(),
    purpose: (g.purpose || 'general').toLowerCase(),
    receive: g.receive ?? false,
  };

  /** 以「該群組目前的有效值」為基底，避免第一次改單一欄位時把其他欄位重設成 draft/general/false */
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

  /** 就地修正單一品項欄位（以目前有效值為基底，避免覆蓋其他已改欄位） */
  const patchItem = (index: number, itemIndex: number, patch: Partial<ImportItemRow>) => {
    setItemEdits((prev) => {
      const group = groups.find((g) => g.index === index);
      const base = prev[index] ?? group?.items ?? [];
      const next = base.map((it, i) => (i === itemIndex ? { ...it, ...patch } : it));
      return { ...prev, [index]: next };
    });
  };

  const removeItem = (index: number, itemIndex: number) => {
    setItemEdits((prev) => {
      const group = groups.find((g) => g.index === index);
      const base = prev[index] ?? group?.items ?? [];
      return { ...prev, [index]: base.filter((_, i) => i !== itemIndex) };
    });
  };

  const addItem = (index: number) => {
    setItemEdits((prev) => {
      const group = groups.find((g) => g.index === index);
      const base = prev[index] ?? group?.items ?? [];
      return { ...prev, [index]: [...base, { quantity: 1, unit_cost: 0 }] };
    });
  };

  const resetItems = (index: number) => {
    setItemEdits((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  // 尚未被手動選值取代的日期問題（使用者選完日期即自動解除）
  const unresolvedDateIssues = (g: ImportGroup): ImportDateIssue[] => {
    const edit = editOf(g);
    return (g.dateIssues ?? []).filter((issue) => !edit[DATE_OVERRIDE_KEY[issue.field]]);
  };

  const dateIssueField = (g: ImportGroup, field: ImportDateIssue['field']): ImportDateIssue | undefined =>
    unresolvedDateIssues(g).find((issue) => issue.field === field);

  const groupErrors = (g: ImportGroup): string[] => {
    const errs = [...g.errors];
    if (!supplierId) errs.push('請先選擇供應商');
    if (supplierMismatch.get(g.index)) {
      errs.push(`檔案供應商「${g.supplier_code}」與所選供應商「${supplier?.name}」不符`);
    }
    for (const issue of unresolvedDateIssues(g)) {
      const label = DATE_ISSUE_LABELS[issue.field];
      const fix = EDITABLE_DATE_FIELDS.includes(issue.field)
        ? `請點「${label}」欄手動選擇日期`
        : `請於檔案中修正「${label}」`;
      errs.push(`第 ${issue.row + 1} 列${label}「${issue.raw}」無法辨識，${fix}`);
    }
    // 品項就地修正後才做檢查，避免使用者改完數量仍被檔案中的舊值擋下
    const items = itemsOf(g);
    if (items.length === 0) errs.push('沒有品項');
    for (let i = 0; i < items.length; i += 1) errs.push(...itemErrors(items[i], i));
    return errs;
  };

  const errorGroups = groups.filter(g => groupErrors(g).length > 0);
  const selectedGroups = groups.filter(g => !excluded[g.index] && groupErrors(g).length === 0);
  const totalItems = groups.reduce((sum, g) => sum + itemsOf(g).length, 0);
  const totalQuantity = groups.reduce(
    (sum, g) => sum + itemsOf(g).reduce((s, i) => s + (i.quantity || 0), 0),
    0,
  );
  /** 將匯入張數的金額合計（僅計勾選且無錯誤者） */
  const selectedAmount = selectedGroups.reduce((sum, g) => sum + groupAmount(itemsOf(g)), 0);
  /** 全部群組的金額合計（未過濾勾選／錯誤，用於預覽總覽） */
  const groupAmountAll = groups.reduce((sum, g) => sum + groupAmount(itemsOf(g)), 0);

  // 與伺服端 _po_resolve_item 的 ambiguous 定義一致：同料號多筆對照且無主對照
  const groupAmbiguousCodes = (g: ImportGroup): string[] => ambiguousCodesOf(itemsOf(g), mappingCodeStats);

  const ambiguousGroups = groups.filter(g => ambiguousCodesOf(itemsOf(g), mappingCodeStats).length > 0);
  const ambiguousCodeCount = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const code of ambiguousCodesOf(itemsOf(g), mappingCodeStats)) set.add(code);
    }
    return set.size;
  }, [groups, itemsOf, mappingCodeStats]);

  const reset = () => {
    setView('setup');
    setActiveTab('upload');
    setPastedText('');
    setParseResult(null);
    setFileName('');
    setEdits({});
    setExcluded({});
    setItemEdits({});
    setExpanded({});
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /**
   * 未選供應商時不得進入預覽：匯入是「單一供應商批次」，缺供應商時逐列比對料號／成本都無從做起，
   * 且伺服端會整批失敗。故在 parse 前就先擋下（檔案上傳與貼上內容兩條路徑都必須經過）。
   */
  const requireSupplier = (): boolean => {
    if (supplierId) return true;
    toast.error('請先選擇供應商');
    return false;
  };

  const handleFile = async (file: File) => {
    if (!requireSupplier()) return;
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
            // 送出的是「使用者就地修正後」的品項，而非檔案原始值
            items: itemsOf(g),
            status: edit.status,
            purpose: edit.purpose,
            receive: edit.receive,
            // 手動選定的日期優先於檔案解析值（Excel 序號／格式錯誤時由使用者補）
            order_date: edit.orderDate ?? g.order_date,
            expected_date: edit.expectedDate ?? g.expected_date,
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
                    if (!requireSupplier()) return;
                    setParseResult(await parseImportText(pastedText, '貼上內容'));
                    setView('preview');
                  }}
                  disabled={!pastedText.trim() || !supplierId}
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
              <span>・</span>
              <span>
                總金額 <strong className="text-foreground">{formatCurrency(groupAmountAll)}</strong>
              </span>
              {selectedGroups.length !== groups.length && (
                <Badge variant="secondary">
                  將匯入 {selectedGroups.length} 張／{formatCurrency(selectedAmount)}
                </Badge>
              )}
              {errorGroups.length > 0 && (
                <Badge variant="destructive">需修正 {errorGroups.length} 張</Badge>
              )}
              {ambiguousGroups.length > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  料號歧義 {ambiguousCodeCount} 個料號／{ambiguousGroups.length} 張
                </Badge>
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
                      <th className="text-right px-3 py-2 font-medium">金額</th>
                      <th className="text-left px-3 py-2 font-medium">檢查</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {groups.map((g) => {
                      const edit = editOf(g);
                      const errs = groupErrors(g);
                      const ambiguousCodes = groupAmbiguousCodes(g);
                      const isExcluded = !!excluded[g.index];
                      const existingCount = g.supplier_order_number
                        ? existingPoCount.get(g.supplier_order_number) || 0
                        : 0;
                      const gItems = itemsOf(g);
                      const gQty = gItems.reduce((s, i) => s + (i.quantity || 0), 0);
                      const isExpanded = !!expanded[g.index];
                      return (
                        <Fragment key={g.index}>
                        <tr className={cn(
                          errs.length ? 'bg-destructive/5' : '',
                          isExpanded && 'bg-muted/30',
                        )}>
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
                          <td className="px-3 py-2">
                            <ImportDateCell
                              value={edit.orderDate ?? g.order_date}
                              invalid={dateIssueField(g, 'order_date') !== undefined}
                              raw={dateIssueField(g, 'order_date')?.raw}
                              placeholder="今天"
                              ariaLabel={`第 ${g.index + 1} 張採購日期`}
                              onChange={(v) => patchEdit(g.index, { orderDate: v })}
                              onReset={edit.orderDate ? () => patchEdit(g.index, { orderDate: undefined }) : undefined}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <ImportDateCell
                              value={edit.expectedDate ?? g.expected_date}
                              invalid={dateIssueField(g, 'expected_date') !== undefined}
                              raw={dateIssueField(g, 'expected_date')?.raw}
                              placeholder="未填"
                              ariaLabel={`第 ${g.index + 1} 張預計到貨日`}
                              onChange={(v) => patchEdit(g.index, { expectedDate: v })}
                              onReset={edit.expectedDate ? () => patchEdit(g.index, { expectedDate: undefined }) : undefined}
                            />
                          </td>
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
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:underline"
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? '收合' : '展開'}第 ${g.index + 1} 張採購單的品項`}
                              onClick={() => setExpanded((prev) => ({ ...prev, [g.index]: !prev[g.index] }))}
                            >
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                              {gItems.length} 列（{gQty} 件）
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                            {formatCurrency(groupAmount(gItems))}
                          </td>
                          <td className="px-3 py-2">
                            {errs.length ? (
                              <span className="flex items-start gap-1 text-destructive text-xs">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errs[0]}
                                {errs.length > 1 && <span className="text-muted-foreground">等 {errs.length} 項</span>}
                              </span>
                            ) : ambiguousCodes.length > 0 ? (
                              <span
                                className="flex items-start gap-1 text-amber-700 text-xs"
                                title={`料號歧義：${ambiguousCodes.join('、')}（將依最近更新的對照匯入）`}
                              >
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                料號歧義 {ambiguousCodes.length} 個
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-emerald-600 text-xs">
                                <CheckCircle2 className="h-3.5 w-3.5" /> 就緒
                              </span>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} className="px-3 pb-3">
                              <ImportItemsEditor
                                groupLabel={`第 ${g.index + 1} 張（${g.supplier_order_number || '未填單號'}）`}
                                items={gItems}
                                dirty={itemEdits[g.index] !== undefined}
                                onPatch={(i, patch) => patchItem(g.index, i, patch)}
                                onRemove={(i) => removeItem(g.index, i)}
                                onAdd={() => addItem(g.index)}
                                onReset={() => resetItems(g.index)}
                              />
                            </td>
                          </tr>
                        )}
                        </Fragment>
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

            {ambiguousGroups.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-50 p-2 text-xs space-y-1 shrink-0 max-h-32 overflow-y-auto">
                <div className="font-medium text-amber-800">
                  以下料號在同一供應商有多筆商品對照、且未設定主對照，將依「最近更新的對照」匯入（不影響匯入，但請先確認商品是否正確）：
                </div>
                {ambiguousGroups.map((g) => (
                  <div key={g.index} className="text-amber-800">
                    <span className="font-medium">第 {g.index + 1} 張（{g.supplier_order_number || '未填單號'}）：</span>
                    {groupAmbiguousCodes(g).join('、')}
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground shrink-0">
              點「品項」欄可展開並直接修正品名／廠商料號／SKU／數量／單價，或新增、刪除品項，修正後會即時重算該張金額與檢核結果。
              逐品項判重（供應商＋廠商單號＋商品／變體）由伺服器執行，重複品項不會重複建立，將於結果畫面列出「略過」明細。
              序號／批號數量不符會在伺服端整張回退。
              廠商料號若對應多筆商品且未設主對照，將以最近更新的對照匯入（可於「供應商商品對照」設定主對照）。
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
                  : `確認建立 ${selectedGroups.length} 張／${formatCurrency(selectedAmount)}`}
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
