import { useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Upload, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Plus, Info } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useSupplierMappings, SupplierProductMapping, BatchMappingItem } from '../../hooks/useSupplierMappings';
import { MappingDiffList, ExistingTargetsList } from './mappingDiffView';
import { diffRowsOf } from './mappingDiff';
import { FilterChip } from './mappingFilterChips';

interface ProductVariant {
  id: string;
  name: string | null;
  sku: string;
}

interface ProductWithVariants {
  id: string;
  name: string;
  code: string;
  variants: ProductVariant[];
}

interface MatchedProductSummary {
  id: string;
  name: string;
}

interface MatchedVariantSummary {
  id: string;
  name: string | null;
  sku: string;
}

/** 比對索引的命中項：同時帶出變體本身與其所屬產品，供跨欄位交叉驗證 */
interface VariantHit {
  variant: ProductVariant;
  product: ProductWithVariants;
}

/** 衝突／歧義訊息用的可讀標示：變體名稱（變體 SKU・所屬產品） */
const hitLabel = (hit: VariantHit) =>
  `${hit.variant.name || '（無名稱）'}（${hit.variant.sku}・${hit.product.name}）`;

interface MappingImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  onImportComplete: () => void;
}

/** 導致此列無法匯入的原因；所有情況皆為硬擋，必須回檔案修正後重上 */
type MatchIssue =
  /** 同一列的變體 SKU 與變體名稱解析出不同變體 */
  | 'field_conflict'
  /** 變體名稱同時對應到多個變體，無法唯一判定（DB 無名稱唯一約束） */
  | 'variant_name_ambiguous'
  /** 完全查無對應變體（含未提供任何可匹配欄位） */
  | 'no_variant_matched';

interface ParsedMappingRow {
  row_index: number;
  vendor_product_id: string;
  vendor_product_name: string;
  internal_sku: string;
  internal_variant_name: string;
  unit_cost: number | null;
  match_status: 'matched' | 'unmatched' | 'conflict';
  match_method?: 'variant_sku' | 'variant_name';
  /** 硬擋原因；已成功匹配時為 undefined */
  match_issue?: MatchIssue;
  /** match_issue 對應的人類可讀說明，用於列內顯示與底部問題清單 */
  match_issue_text?: string;
  matched_product?: MatchedProductSummary;
  matched_variant?: MatchedVariantSummary;
  /** 將更新的既有對照（原始資料）；僅「同料號 + 相同內部目標」時存在 */
  conflict_existing?: SupplierProductMapping;
  /** 此廠商代號在資料庫中已存在的全部對照（原始資料） */
  existing_rows?: SupplierProductMapping[];
  /** 此廠商代號已存在的對照筆數（>0 表示本次是新增對照目標，而非新建料號） */
  existing_target_count?: number;
  /** 同一檔案內出現重複的「料號 + 相同內部目標」，此列不會被匯入 */
  duplicate_in_file?: boolean;
  /** 檔案若提供「主對照」欄位則依欄位指定；未提供時留空由寫入邏輯自動判定 */
  is_primary?: boolean;
}

/** 預覽列的互斥分類，同時作為狀態篩選器的篩選值 */
type RowCategory =
  | 'new'
  | 'new_target'
  | 'update'
  | 'duplicate'
  | 'unmatched'
  | 'field_conflict'
  | 'ambiguous_variant';
/** no_change 為「將更新但實際無變動」的疊加篩選值 */
type StatusFilter = RowCategory | 'no_change' | 'all';

/** 分類優先序：檔案內重複 > 欄位矛盾 > 名稱歧義 > 未匹配 > 將更新 > 新增對照目標 > 新增對照 */
const categoryOf = (row: ParsedMappingRow): RowCategory => {
  if (row.duplicate_in_file) return 'duplicate';
  if (row.match_issue === 'field_conflict') return 'field_conflict';
  if (row.match_issue === 'variant_name_ambiguous') return 'ambiguous_variant';
  if (row.match_issue || !row.matched_product || row.match_status === 'unmatched') return 'unmatched';
  if (row.match_status === 'conflict') return 'update';
  return (row.existing_target_count || 0) > 0 ? 'new_target' : 'new';
};

const CATEGORY_LABEL: Record<StatusFilter, string> = {
  all: '全部',
  new: '已匹配（新增對照）',
  new_target: '新增對照目標',
  update: '將更新',
  no_change: '完全相同（不需匯入）',
  duplicate: '檔案內重複',
  unmatched: '未匹配',
  field_conflict: '欄位矛盾',
  ambiguous_variant: '變體名稱歧義',
};

/** 可匯入的分類（新增對照 / 新增對照目標 / 將更新） */
const isImportableCategory = (category: RowCategory) =>
  category === 'new' || category === 'new_target' || category === 'update';

/** 既有對照且四個欄位都沒變動 → 不需再次匯入，只提醒 */
const isNoChangeRow = (row: ParsedMappingRow) =>
  categoryOf(row) === 'update' && diffRowsOf(row).filter(d => d.changed).length === 0;

export function MappingImportDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  onImportComplete,
}: MappingImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedData, setParsedData] = useState<ParsedMappingRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { mappings: existingMappings, batchSaveMappingsMutation } = useSupplierMappings(supplierId);

  const { data: allProducts = [] } = useQuery({
    queryKey: ['all-products-for-mapping'],
    queryFn: async (): Promise<ProductWithVariants[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name,
          variants:product_variants(id, name, sku)
        `)
        .limit(5000);

      if (error) throw error;
      return (data || []) as unknown as ProductWithVariants[];
    },
    enabled: open,
  });

  const resetState = () => {
    setParsedData([]);
    setIsProcessing(false);
    setIsImporting(false);
    setError(null);
    setStatusFilter('all');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  /** 比對一律落在變體層級；產品代碼與產品名稱不再參與比對 */
  const variantSkuIndex = useMemo(() => {
    const index = new Map<string, VariantHit[]>();
    for (const p of allProducts) {
      for (const v of p.variants || []) {
        const key = v.sku?.trim().toLowerCase();
        if (!key) continue;
        const bucket = index.get(key);
        if (bucket) bucket.push({ variant: v, product: p });
        else index.set(key, [{ variant: v, product: p }]);
      }
    }
    return index;
  }, [allProducts]);

  const variantNameIndex = useMemo(() => {
    const index = new Map<string, VariantHit[]>();
    for (const p of allProducts) {
      for (const v of p.variants || []) {
        const key = v.name?.trim().toLowerCase();
        if (!key) continue;
        const bucket = index.get(key);
        if (bucket) bucket.push({ variant: v, product: p });
        else index.set(key, [{ variant: v, product: p }]);
      }
    }
    return index;
  }, [allProducts]);

  /**
   * 以「變體 SKU」與「變體名稱」兩個欄位交叉驗證，兩者皆須唯一命中且指向同一變體。
   * 任一欄位無法唯一判定、或兩者互相矛盾，一律回傳 match_issue 硬擋該列。
   */
  const findMatch = useCallback((variantSku: string, variantName: string) => {
    const skuKey = variantSku.trim().toLowerCase();
    const nameKey = variantName.trim().toLowerCase();
    const skuHits = skuKey ? variantSkuIndex.get(skuKey) || [] : [];
    const nameHits = nameKey ? variantNameIndex.get(nameKey) || [] : [];

    const base = { matched_product: undefined, matched_variant: undefined, match_method: undefined };

    if (!skuKey && !nameKey) {
      return {
        ...base,
        match_issue: 'no_variant_matched' as const,
        match_issue_text: '未提供可匹配的欄位（需填寫變體 SKU 或變體名稱）',
      };
    }

    // 變體名稱對應到多個變體：即使 SKU 命中也擋下（檔案宣稱了一個不唯一的事實）
    if (nameHits.length > 1) {
      return {
        ...base,
        match_issue: 'variant_name_ambiguous' as const,
        match_issue_text: `變體名稱「${variantName.trim()}」對應到 ${nameHits.length} 個變體（${nameHits
          .map(h => h.variant.sku)
          .join('／')}），無法唯一判定`,
      };
    }

    const skuHit = skuHits.length === 1 ? skuHits[0] : null;
    const nameHit = nameHits.length === 1 ? nameHits[0] : null;

    // SKU 與變體名稱都命中但指向不同變體 → 欄位互相矛盾
    if (skuHit && nameHit && skuHit.variant.id !== nameHit.variant.id) {
      return {
        matched_product: { id: skuHit.product.id, name: skuHit.product.name },
        matched_variant: { id: skuHit.variant.id, name: skuHit.variant.name, sku: skuHit.variant.sku },
        match_method: undefined,
        match_issue: 'field_conflict' as const,
        match_issue_text: `變體 SKU「${variantSku.trim()}」對應 ${hitLabel(skuHit)}，但變體名稱「${variantName.trim()}」對應 ${hitLabel(nameHit)}，兩者不一致`,
      };
    }

    const hit = skuHit || nameHit;
    if (!hit) {
      const provided = [
        skuKey ? `變體 SKU「${variantSku.trim()}」` : null,
        nameKey ? `變體名稱「${variantName.trim()}」` : null,
      ].filter(Boolean).join('、');
      return {
        ...base,
        match_issue: 'no_variant_matched' as const,
        match_issue_text: `${provided} 皆查無對應的變體`,
      };
    }

    return {
      matched_product: { id: hit.product.id, name: hit.product.name },
      matched_variant: { id: hit.variant.id, name: hit.variant.name, sku: hit.variant.sku },
      match_method: skuHit ? ('variant_sku' as const) : ('variant_name' as const),
      match_issue: undefined,
      match_issue_text: undefined,
    };
  }, [variantSkuIndex, variantNameIndex]);

  /** 同一廠商代號可有多筆對照（多目標），因此改為列出全部既有對照 */
  const findExistingMappings = (vendorProductId: string) =>
    existingMappings.filter(m => m.vendor_product_id.trim() === vendorProductId.trim());

  /** 解析「主對照」欄位：是/否、true/false、Y/N、primary/secondary */
  const parsePrimaryFlag = (raw: unknown): boolean | undefined => {
    const text = String(raw ?? '').trim().toLowerCase();
    if (!text) return undefined;
    if (['是', 'y', 'yes', 'true', '1', 'primary', '主'].includes(text)) return true;
    if (['否', 'n', 'no', 'false', '0', 'secondary', '次'].includes(text)) return false;
    return undefined;
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setParsedData([]);

    try {
      const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
      let rawData: (string | number)[][] = [];

      if (isExcel) {
        const data = await file.arrayBuffer();
        const xlsx = await import('xlsx');
        const workbook = xlsx.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1, blankrows: false }) as (string | number)[][];
      } else {
        const text = await file.text();
        const { default: Papa } = await import('papaparse');
        const result = Papa.parse(text, { header: false, skipEmptyLines: true });
        rawData = result.data as (string | number)[][];
      }

      if (rawData.length < 2) {
        setError('檔案內容不足，至少需要標題列和一筆資料');
        setIsProcessing(false);
        return;
      }

      const headers = rawData[0].map((h) => String(h || '').trim());
      const rows = rawData.slice(1);

      const vendorIdIdx = headers.findIndex((h) =>
        h === '廠商代號' || h === 'vendor_product_id' || h === '廠商料號'
      );
      const vendorNameIdx = headers.findIndex((h) =>
        h === '廠商品名' || h === 'vendor_product_name' || h === '廠商品名稱'
      );
      // 舊檔的「內部SKU」等別名一律以「變體 SKU」語意解讀；產品代碼與產品名稱不再作為匹配欄位
      const skuIdx = headers.findIndex((h) =>
        h === '內部SKU' || h === 'internal_sku' || h === '變體 SKU' || h === '變體SKU' || h === 'SKU'
      );
      const variantNameIdx = headers.findIndex((h) =>
        h === '內部變體名稱' || h === 'internal_variant_name' || h === '變體名稱'
      );
      const unitCostIdx = headers.findIndex((h) =>
        h === '單價' || h === 'unit_cost' || h === 'vendor_unit_cost'
      );
      const primaryIdx = headers.findIndex((h) =>
        h === '主對照' || h === 'is_primary' || h === 'primary' || h === '是否主對照'
      );

      if (vendorIdIdx === -1) {
        setError(`找不到「廠商代號」欄位。檔案欄位: ${headers.join(', ')}`);
        setIsProcessing(false);
        return;
      }

      const parsed: ParsedMappingRow[] = rows
        .map((row, idx) => ({ row, rowIndex: idx + 2 }))
        .filter(({ row }) => row[vendorIdIdx] && String(row[vendorIdIdx]).trim() !== '')
        .map(({ row, rowIndex }) => {
          const variantSku = skuIdx !== -1 ? String(row[skuIdx] || '').trim() : '';
          const variantName = variantNameIdx !== -1 ? String(row[variantNameIdx] || '').trim() : '';
          const { matched_product, matched_variant, match_method, match_issue, match_issue_text } =
            findMatch(variantSku, variantName);
          const vendorProductId = String(row[vendorIdIdx]).trim();
          const existingForCode = findExistingMappings(vendorProductId);

          // 完全相同的內部目標（產品＋變體）才算「更新既有對照」；
          // 同料號但指向其他目標是合法的多目標情境，屬於「新增對照目標」
          const exactExisting = matched_product
            ? existingForCode.find(m =>
                m.internal_product_id === matched_product.id &&
                (m.internal_variant_id ?? null) === (matched_variant?.id ?? null)
              )
            : undefined;

          // 有 match_issue 即為硬擋（欄位矛盾／名稱歧義／查無變體），一律不視為可匯入
          let matchStatus: 'matched' | 'unmatched' | 'conflict' = 'unmatched';
          if (matched_product && !match_issue) matchStatus = exactExisting ? 'conflict' : 'matched';

          return {
            row_index: rowIndex,
            vendor_product_id: vendorProductId,
            vendor_product_name: vendorNameIdx !== -1 ? String(row[vendorNameIdx] || '').trim() : '',
            internal_sku: variantSku,
            internal_variant_name: variantName,
            unit_cost: unitCostIdx !== -1 ? Number(row[unitCostIdx]) || null : null,
            match_status: matchStatus,
            match_method,
            match_issue,
            match_issue_text,
            matched_product,
            matched_variant,
            conflict_existing: exactExisting || undefined,
            existing_rows: existingForCode,
            existing_target_count: existingForCode.length,
            is_primary: primaryIdx !== -1 ? parsePrimaryFlag(row[primaryIdx]) : undefined,
          };
        });

      // 檔案內重複檢查：同一「料號 + 相同內部目標」只保留第一列，後續標記為重複不予匯入
      const seenInFile = new Map<string, number>();
      parsed.forEach((row) => {
        if (row.match_issue || !row.matched_product) return;
        const key = `${row.vendor_product_id}|${row.matched_product.id}|${row.matched_variant?.id || 'null'}`;
        if (seenInFile.has(key)) {
          row.duplicate_in_file = true;
        } else {
          seenInFile.set(key, row.row_index);
        }
      });

      setParsedData(parsed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知錯誤';
      setError(`解析失敗: ${message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleImport = async () => {
    const validItems = parsedData.filter(r => isImportableCategory(categoryOf(r)) && !isNoChangeRow(r));
    if (validItems.length === 0) return;

    setIsImporting(true);
    setError(null);
    try {
      const payload: BatchMappingItem[] = validItems.map(item => ({
        supplier_id: supplierId,
        vendor_product_id: item.vendor_product_id,
        vendor_product_name: item.vendor_product_name || null,
        internal_product_id: item.matched_product!.id,
        // 可匯入列必定已解析到變體（產品代碼比對已移除）
        internal_variant_id: item.matched_variant!.id,
        vendor_unit_cost: item.unit_cost ?? null,
        is_primary: item.is_primary,
        row_index: item.row_index,
      }));

      await batchSaveMappingsMutation.mutateAsync(payload);

      onImportComplete();
      handleClose(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知錯誤';
      setError(message);
    } finally {
      setIsImporting(false);
    }
  };

  const rowViews = useMemo(
    () =>
      parsedData.map(row => {
        const category = categoryOf(row);
        // 既有對照只顯示「實際會被改寫」的欄位，沒變動的不顯示
        const diffs = diffRowsOf(row).filter(d => d.changed);
        return { row, category, diffs, noChange: category === 'update' && diffs.length === 0 };
      }),
    [parsedData],
  );

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: rowViews.length,
      new: 0,
      new_target: 0,
      update: 0,
      no_change: 0,
      duplicate: 0,
      unmatched: 0,
      field_conflict: 0,
      ambiguous_variant: 0,
    };
    rowViews.forEach(v => {
      base[v.category] += 1;
      if (v.noChange) base.no_change += 1;
    });
    return base;
  }, [rowViews]);

  const visibleViews = useMemo(() => {
    if (statusFilter === 'all') return rowViews;
    if (statusFilter === 'no_change') return rowViews.filter(v => v.noChange);
    return rowViews.filter(v => v.category === statusFilter);
  }, [rowViews, statusFilter]);

  /** 可匯入的列（新增對照 / 新增對照目標 / 實際有變動的將更新），不受畫面篩選影響 */
  const importableRows = useMemo(
    () => rowViews.filter(v => isImportableCategory(v.category) && !v.noChange),
    [rowViews],
  );
  /** 既有對照中，實際有欄位會被改寫的列數 */
  const changedFieldCount = useMemo(
    () => rowViews.filter(v => v.category === 'update' && !v.noChange).length,
    [rowViews],
  );

  /** 因欄位矛盾／名稱歧義／查無變體而被硬擋的列，需回檔案修正 */
  const blockedRows = useMemo(() => rowViews.filter(v => !!v.row.match_issue), [rowViews]);

  const toggleFilter = (value: StatusFilter) =>
    setStatusFilter(prev => (prev === value ? 'all' : value));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            匯入產品對照 - {supplierName}
          </DialogTitle>
          <DialogDescription>
            上傳 CSV 或 Excel 檔案，系統將自動匹配內部變體並建立對照關係；已存在的對照會顯示原始資料與變更後內容供確認
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {parsedData.length === 0 ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" aria-hidden="true" />
                <p className="text-sm text-muted-foreground mb-4">
                  選擇 CSV 或 Excel 檔案上傳
                </p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={handleFileChange}
                  className="max-w-xs mx-auto"
                  disabled={isProcessing}
                />
                {isProcessing && (
                  <p className="text-sm text-muted-foreground mt-4 flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    解析中...
                  </p>
                )}
              </div>

              <div className="bg-muted/50 rounded-md p-4 text-sm">
                <p className="font-medium mb-2">檔案格式說明：</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>必要欄位：<span className="font-medium text-foreground">廠商代號</span></li>
                  <li>匹配欄位（擇一，僅比對<span className="font-medium text-foreground">變體</span>層級）：
                    <span className="font-medium text-foreground">變體 SKU</span>（舊檔欄名「內部SKU」亦可）、
                    <span className="font-medium text-foreground">內部變體名稱</span>
                  </li>
                  <li>比對方式為<span className="font-medium text-foreground">去除頭尾空白後完全相同、忽略英文大小寫</span>；產品代碼與產品名稱<span className="font-medium text-foreground">不參與比對</span></li>
                  <li>兩個匹配欄位若指向<span className="font-medium text-foreground">不同變體</span>，或變體名稱對應到多個變體，該列會標示為<span className="font-medium text-foreground">欄位矛盾</span>／<span className="font-medium text-foreground">變體名稱歧義</span>並<span className="font-medium text-foreground">不予匯入</span>，需修正後重新上傳</li>
                  <li>可選欄位：廠商品名、單價</li>
                  <li>可選欄位：<span className="font-medium text-foreground">主對照</span>（是／否；未提供時該料號第一個目標會自動成為主對照）</li>
                  <li>同一個「廠商代號」可對應多個內部產品／變體，系統不再視為重複資料</li>
                  <li>已存在對照時，預覽表會顯示<span className="font-medium text-foreground">原始資料 → 變更後</span>的差異，<span className="font-medium text-foreground">只列出有變動的欄位</span>（沒變動的不會被覆寫）</li>
                  <li>若檔案內容與資料庫<span className="font-medium text-foreground">完全相同</span>，該筆會標示「完全相同，不需匯入」並<span className="font-medium text-foreground">略過不寫入</span></li>
                  <li>上排統計標籤可點擊篩選預覽資料（再點一次取消篩選）</li>
                  <li>建議先匯出現有對照，修改後再匯入</li>
                  <li>也可使用產品管理頁面的匯出檔案作為對照資料來源</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                  共 {counts.all} 筆
                </FilterChip>
                {counts.new > 0 && (
                  <FilterChip
                    tone="green"
                    active={statusFilter === 'new'}
                    onClick={() => toggleFilter('new')}
                    icon={<CheckCircle2 className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    已匹配 {counts.new}
                  </FilterChip>
                )}
                {counts.new_target > 0 && (
                  <FilterChip
                    active={statusFilter === 'new_target'}
                    onClick={() => toggleFilter('new_target')}
                    icon={<Plus className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    新增對照目標 {counts.new_target}
                  </FilterChip>
                )}
                {counts.update > 0 && (
                  <FilterChip
                    tone="amber"
                    active={statusFilter === 'update'}
                    onClick={() => toggleFilter('update')}
                    icon={<AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    將更新 {counts.update}
                  </FilterChip>
                )}
                {changedFieldCount > 0 && (
                  <Badge variant="outline" className="text-sm border-amber-500/50 text-amber-600 dark:text-amber-400">
                    實際變更 {changedFieldCount}
                  </Badge>
                )}
                {counts.no_change > 0 && (
                  <FilterChip
                    tone="outline"
                    active={statusFilter === 'no_change'}
                    onClick={() => toggleFilter('no_change')}
                    icon={<Info className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    完全相同不需匯入 {counts.no_change}
                  </FilterChip>
                )}
                {counts.duplicate > 0 && (
                  <FilterChip
                    tone="destructive"
                    active={statusFilter === 'duplicate'}
                    onClick={() => toggleFilter('duplicate')}
                    icon={<XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    檔案內重複 {counts.duplicate}
                  </FilterChip>
                )}
                {counts.unmatched > 0 && (
                  <FilterChip
                    tone="destructive"
                    active={statusFilter === 'unmatched'}
                    onClick={() => toggleFilter('unmatched')}
                    icon={<XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    未匹配 {counts.unmatched}
                  </FilterChip>
                )}
                {counts.field_conflict > 0 && (
                  <FilterChip
                    tone="destructive"
                    active={statusFilter === 'field_conflict'}
                    onClick={() => toggleFilter('field_conflict')}
                    icon={<XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    欄位矛盾 {counts.field_conflict}
                  </FilterChip>
                )}
                {counts.ambiguous_variant > 0 && (
                  <FilterChip
                    tone="destructive"
                    active={statusFilter === 'ambiguous_variant'}
                    onClick={() => toggleFilter('ambiguous_variant')}
                    icon={<XCircle className="h-3 w-3 mr-1" aria-hidden="true" />}
                  >
                    變體名稱歧義 {counts.ambiguous_variant}
                  </FilterChip>
                )}
                {statusFilter !== 'all' && (
                  <span className="text-xs text-muted-foreground">
                    顯示 {visibleViews.length} / {counts.all} 筆（點選同一狀態可取消篩選）
                  </span>
                )}
                <div className="ml-auto">
                  <Button variant="outline" size="sm" onClick={resetState}>
                    重新選擇檔案
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-auto min-h-0 border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14 text-center">列號</TableHead>
                      <TableHead>廠商代號</TableHead>
                      <TableHead>廠商品名</TableHead>
                      <TableHead>變體 SKU</TableHead>
                      <TableHead>變體名稱</TableHead>
                      <TableHead>匹配結果</TableHead>
                      <TableHead>既有對照 / 變更內容</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleViews.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                          此檔案沒有符合「{CATEGORY_LABEL[statusFilter]}」的資料
                        </TableCell>
                      </TableRow>
                    ) : (
                      visibleViews.map(({ row, category, diffs, noChange }, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-center font-mono text-xs text-muted-foreground">
                            {row.row_index}
                          </TableCell>
                          <TableCell className="font-medium font-mono text-xs">
                            {row.vendor_product_id}
                          </TableCell>
                          <TableCell>{row.vendor_product_name || '-'}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {row.internal_sku || <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>
                            {row.internal_variant_name || <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell>
                            {category === 'duplicate' ? (
                              <div className="flex items-center text-destructive text-sm">
                                <XCircle className="h-4 w-4 mr-1" aria-hidden="true" />
                                檔案內重複，不予匯入
                              </div>
                            ) : row.match_issue ? (
                              <div className="text-destructive text-sm">
                                <div className="flex items-center">
                                  <XCircle className="h-4 w-4 mr-1" aria-hidden="true" />
                                  {row.match_issue === 'field_conflict'
                                    ? '欄位矛盾，不予匯入'
                                    : row.match_issue === 'variant_name_ambiguous'
                                      ? '變體名稱歧義，不予匯入'
                                      : '未找到匹配變體'}
                                </div>
                                <p className="text-xs mt-1 text-destructive/90">{row.match_issue_text}</p>
                              </div>
                            ) : category === 'new' || category === 'new_target' ? (
                              <div className="flex items-center text-green-600 text-sm flex-wrap">
                                <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
                                {row.matched_product?.name}
                                {row.matched_variant && (
                                  <span className="text-muted-foreground ml-1">({row.matched_variant.name})</span>
                                )}
                                <Badge variant="outline" className="ml-2 text-xs">
                                  {row.match_method === 'variant_sku' ? '變體SKU' : '變體名稱'}
                                </Badge>
                                {category === 'new_target' && (
                                  <Badge variant="secondary" className="ml-1 text-xs">
                                    此料號已有 {row.existing_target_count} 筆對照，將新增為第 {row.existing_target_count! + 1} 筆
                                  </Badge>
                                )}
                              </div>
                            ) : category === 'update' ? (
                              noChange ? (
                                <div className="flex items-center text-muted-foreground text-sm">
                                  <Info className="h-4 w-4 mr-1" aria-hidden="true" />
                                  完全相同，不需匯入
                                </div>
                              ) : (
                                <div className="text-amber-600 text-sm flex items-center flex-wrap">
                                  <AlertTriangle className="h-4 w-4 mr-1" aria-hidden="true" />
                                  已有對照，將更新
                                </div>
                              )
                            ) : (
                              <div className="flex items-center text-destructive text-sm">
                                <XCircle className="h-4 w-4 mr-1" aria-hidden="true" />
                                未找到匹配變體
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {category === 'update' ? (
                              <>
                                {noChange ? (
                                  <p className="text-xs text-muted-foreground">
                                    與資料庫完全相同，本次不會寫入（僅提醒）
                                  </p>
                                ) : (
                                  <p className="text-xs text-muted-foreground">原始資料 → 變更後（僅列出有變動的欄位）</p>
                                )}
                                <MappingDiffList rows={diffs} />
                              </>
                            ) : category === 'new_target' ? (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  原始資料（資料庫既有對照），本次將新增上方目標
                                </p>
                                <ExistingTargetsList rows={row.existing_rows!} />
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {category === 'new' ? '資料庫無既有對照，將新增' : '-'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.unit_cost != null ? `$${row.unit_cost}` : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 text-destructive bg-destructive/10 border border-destructive/20 p-3.5 rounded-md text-sm">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="flex-1 whitespace-pre-line font-medium leading-relaxed">
                {error}
              </div>
            </div>
          )}
        {parsedData.length > 0 && blockedRows.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="flex-1 space-y-1">
              <span className="text-destructive">
                有 {blockedRows.length} 筆因無法唯一判定內部變體而不予匯入，請修正後重新上傳：
              </span>
              <ul className="space-y-0.5 text-xs text-destructive/90 list-disc list-inside">
                {blockedRows.map(({ row }) => (
                  <li key={row.row_index}>
                    第 {row.row_index} 列（{row.vendor_product_id}）：{row.match_issue_text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {parsedData.length > 0 && counts.no_change > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-muted-foreground/20 bg-muted/50 p-3 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                提醒：有 {counts.no_change} 筆與資料庫現有對照<strong className="font-medium text-foreground">完全相同</strong>
                ，不會重複匯入（本次將匯入 {importableRows.length} 筆）。
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isImporting}>
            取消
          </Button>
          {parsedData.length > 0 && (
            <Button
              onClick={handleImport}
              disabled={isImporting || importableRows.length === 0}
            >
              {isImporting ? '匯入中...' : `確認匯入 (${importableRows.length} 筆)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
