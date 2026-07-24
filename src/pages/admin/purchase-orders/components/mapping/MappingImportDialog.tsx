import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import * as xlsx from 'xlsx';
import Papa from 'papaparse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Upload, AlertTriangle, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useSupplierMappings, SupplierProductMapping } from '../../hooks/useSupplierMappings';

interface ProductVariant {
  id: string;
  name: string | null;
  sku: string;
  option_1: string | null;
  option_2: string | null;
  option_3: string | null;
}

interface ProductWithVariants {
  id: string;
  name: string;
  sku: string;
  has_variants: boolean;
  variants: ProductVariant[];
}

interface MappingImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  onImportComplete: () => void;
}

interface ParsedMappingRow {
  vendor_product_id: string;
  vendor_product_name: string;
  internal_sku: string;
  internal_product_name: string;
  internal_variant_name: string;
  unit_cost: number | null;
  match_status: 'matched' | 'unmatched' | 'conflict';
  match_method?: 'variant_sku' | 'product_sku' | 'product_name';
  matched_product?: { id: string; name: string; sku: string };
  matched_variant?: { id: string; name: string; sku: string };
  conflict_existing?: SupplierProductMapping;
}

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

  const { mappings: existingMappings, saveMappingMutation } = useSupplierMappings(supplierId);

  const { data: allProducts = [] } = useQuery({
    queryKey: ['all-products-for-mapping'],
    queryFn: async (): Promise<ProductWithVariants[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, sku, has_variants,
          variants:product_variants(id, name, sku, option_1, option_2, option_3)
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  const findMatch = useCallback((variantSku: string, productSku: string, productName: string) => {
    let matchedProduct: ProductWithVariants | null = null;
    let matchedVariant: ProductVariant | null = null;
    let matchMethod: 'variant_sku' | 'product_sku' | 'product_name' | null = null;

    for (const p of allProducts) {
      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          if (variantSku && v.sku && v.sku.toLowerCase() === variantSku.toLowerCase()) {
            matchedProduct = p;
            matchedVariant = v;
            matchMethod = 'variant_sku';
            return { matched_product: matchedProduct, matched_variant: matchedVariant, match_method: matchMethod };
          }
        }
      }
      if (productSku && p.sku && p.sku.toLowerCase() === productSku.toLowerCase()) {
        matchedProduct = p;
        if (p.has_variants && p.variants && p.variants.length === 1) {
          matchedVariant = p.variants[0];
        }
        matchMethod = 'product_sku';
        return { matched_product: matchedProduct, matched_variant: matchedVariant, match_method: matchMethod };
      }
    }

    if (productName) {
      for (const p of allProducts) {
        if (p.name.toLowerCase() === productName.toLowerCase()) {
          matchedProduct = p;
          if (p.has_variants && p.variants && p.variants.length === 1) {
            matchedVariant = p.variants[0];
          }
          matchMethod = 'product_name';
          return { matched_product: matchedProduct, matched_variant: matchedVariant, match_method: matchMethod };
        }
      }
    }

    return { matched_product: null, matched_variant: null, match_method: null };
  }, [allProducts]);

  const checkConflict = (vendorProductId: string) => {
    return existingMappings.find(m => m.vendor_product_id === vendorProductId);
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
        const workbook = xlsx.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1, blankrows: false }) as (string | number)[][];
      } else {
        const text = await file.text();
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
        h === '廠商代號' || h === 'vendor_product_id' || h === '廠商代號'
      );
      const vendorNameIdx = headers.findIndex((h) =>
        h === '廠商品名' || h === 'vendor_product_name' || h === '廠商品名稱'
      );
      const skuIdx = headers.findIndex((h) =>
        h === '內部SKU' || h === 'internal_sku' || h === '變體 SKU' || h === 'SKU'
      );
      const productSkuIdx = headers.findIndex((h) =>
        h === '內部SKU' || h === 'internal_sku' || h === 'SKU'
      );
      const productNameIdx = headers.findIndex((h) =>
        h === '內部產品名稱' || h === 'internal_product_name' || h === '產品名稱'
      );
      const variantNameIdx = headers.findIndex((h) =>
        h === '內部變體名稱' || h === 'internal_variant_name' || h === '變體名稱'
      );
      const unitCostIdx = headers.findIndex((h) =>
        h === '單價' || h === 'unit_cost' || h === 'vendor_unit_cost'
      );

      if (vendorIdIdx === -1) {
        setError(`找不到「廠商代號」欄位。檔案欄位: ${headers.join(', ')}`);
        setIsProcessing(false);
        return;
      }

      const parsed: ParsedMappingRow[] = rows
        .filter((row) => row[vendorIdIdx] && String(row[vendorIdIdx]).trim() !== '')
        .map((row) => {
          const variantSku = skuIdx !== -1 ? String(row[skuIdx] || '').trim() : '';
          const productSku = productSkuIdx !== -1 ? String(row[productSkuIdx] || '').trim() : '';
          const productName = productNameIdx !== -1 ? String(row[productNameIdx] || '').trim() : '';
          const { matched_product, matched_variant, match_method } = findMatch(variantSku || productSku, productSku, productName);
          const vendorProductId = String(row[vendorIdIdx]).trim();
          const conflict = checkConflict(vendorProductId);

          let matchStatus: 'matched' | 'unmatched' | 'conflict' = 'unmatched';
          if (conflict) matchStatus = 'conflict';
          else if (matched_product) matchStatus = 'matched';

          return {
            vendor_product_id: vendorProductId,
            vendor_product_name: vendorNameIdx !== -1 ? String(row[vendorNameIdx] || '').trim() : '',
            internal_sku: variantSku || productSku,
            internal_product_name: productName,
            internal_variant_name: variantNameIdx !== -1 ? String(row[variantNameIdx] || '').trim() : '',
            unit_cost: unitCostIdx !== -1 ? Number(row[unitCostIdx]) || null : null,
            match_status: matchStatus,
            match_method: match_method || undefined,
            matched_product: matched_product || undefined,
            matched_variant: matched_variant || undefined,
            conflict_existing: conflict || undefined,
          };
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
    const validItems = parsedData.filter(r => r.match_status === 'matched' || r.match_status === 'conflict');
    if (validItems.length === 0) return;

    setIsImporting(true);
    try {
      for (const item of validItems) {
        await saveMappingMutation.mutateAsync({
          supplier_id: supplierId,
          vendor_product_id: item.vendor_product_id,
          vendor_product_name: item.vendor_product_name || null,
          internal_product_id: item.matched_product!.id,
          internal_variant_id: item.matched_variant?.id || null,
          vendor_unit_cost: item.unit_cost ?? null,
        });
      }

      onImportComplete();
      handleClose(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知錯誤';
      setError(`匯入失敗: ${message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const matchedCount = parsedData.filter(r => r.match_status === 'matched').length;
  const conflictCount = parsedData.filter(r => r.match_status === 'conflict').length;
  const unmatchedCount = parsedData.filter(r => r.match_status === 'unmatched').length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            匯入產品對照 - {supplierName}
          </DialogTitle>
          <DialogDescription>
            上傳 CSV 或 Excel 檔案，系統將自動匹配內部產品並建立對照關係
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {parsedData.length === 0 ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
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
                  <li>匹配欄位（擇一）：<span className="font-medium text-foreground">內部SKU</span>、<span className="font-medium text-foreground">變體 SKU</span>、<span className="font-medium text-foreground">SKU</span> 或 <span className="font-medium text-foreground">內部產品名稱</span> / <span className="font-medium text-foreground">產品名稱</span></li>
                  <li>可選欄位：廠商品名、內部變體名稱 / 變體名稱、單價</li>
                  <li>建議先匯出現有對照，修改後再匯入</li>
                  <li>也可使用產品管理頁面的匯出檔案作為對照資料來源</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="secondary" className="text-sm">
                  共 {parsedData.length} 筆
                </Badge>
                {matchedCount > 0 && (
                  <Badge variant="default" className="text-sm bg-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    已匹配 {matchedCount}
                  </Badge>
                )}
                {conflictCount > 0 && (
                  <Badge variant="default" className="text-sm bg-amber-500">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    有衝突 {conflictCount}
                  </Badge>
                )}
                {unmatchedCount > 0 && (
                  <Badge variant="destructive" className="text-sm">
                    <XCircle className="h-3 w-3 mr-1" />
                    未匹配 {unmatchedCount}
                  </Badge>
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
                      <TableHead>廠商代號</TableHead>
                      <TableHead>廠商品名</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>匹配結果</TableHead>
                      <TableHead className="text-right">單價</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium font-mono text-xs">
                          {row.vendor_product_id}
                        </TableCell>
                        <TableCell>{row.vendor_product_name || '-'}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {row.internal_sku || <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          {row.match_status === 'matched' && (
                            <div className="flex items-center text-green-600 text-sm">
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              {row.matched_product?.name}
                              {row.matched_variant && (
                                <span className="text-muted-foreground ml-1">({row.matched_variant.name})</span>
                              )}
                              <Badge variant="outline" className="ml-2 text-xs">
                                {row.match_method === 'variant_sku' && '變體SKU'}
                                {row.match_method === 'product_sku' && '產品SKU'}
                                {row.match_method === 'product_name' && '產品名稱'}
                              </Badge>
                            </div>
                          )}
                          {row.match_status === 'conflict' && (
                            <div className="flex items-center text-amber-600 text-sm">
                              <AlertTriangle className="h-4 w-4 mr-1" />
                              已有對照：{row.conflict_existing?.internal_product?.name || '未知'}
                              <span className="text-muted-foreground ml-1">（將覆蓋）</span>
                            </div>
                          )}
                          {row.match_status === 'unmatched' && (
                            <div className="flex items-center text-destructive text-sm">
                              <XCircle className="h-4 w-4 mr-1" />
                              未找到匹配產品
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.unit_cost != null ? `$${row.unit_cost}` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive bg-destructive/5 p-3 rounded-md text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
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
              disabled={isImporting || (matchedCount === 0 && conflictCount === 0)}
            >
              {isImporting ? '匯入中...' : `確認匯入 (${matchedCount + conflictCount} 筆)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
