import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { ImportPreviewDialog, ImportColumn } from '@/components/shared/ImportPreviewDialog';
import { Upload, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { useCategoryBindings, ImportBindingRow } from '../hooks/useCategoryBindings';

interface CategoryBindingImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brands: any[];
  products: any[];
  categories: any[];
  categoryHierarchy: any[];
}

// 分類綁定批次匯入元件

export function CategoryBindingImport({
  open,
  onOpenChange,
  brands,
  products,
  categories,
  categoryHierarchy,
}: CategoryBindingImportProps) {
  const { batchImportBindings } = useCategoryBindings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [parseResult, setParseResult] = useState<ImportBindingRow[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // CSV 匯入處理
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setPreviewError(null);

      const result = await new Promise<any[]>((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => resolve(results.data as any[]),
          error: (err) => reject(err),
        });
      });

      if (result.length === 0) {
        throw new Error('檔案內無資料');
      }

      // 驗證欄位
      const requiredColumns = ['product_sku', 'category_path'];
      const headers = Object.keys(result[0] || {});
      const missingColumns = requiredColumns.filter(col => !headers.includes(col));

      if (missingColumns.length > 0) {
        throw new Error(`缺少必要欄位：${missingColumns.join('、')}`);
      }

      // 預覽資料
      const previewRows = result.map((row: any) => {
        const productSku = row['product_sku'] || row['產品SKU'] || '';
        const variantSku = row['variant_sku'] || row['變體SKU'] || '';
        const categoryPath = row['category_path'] || row['分類路徑'] || '';

        const product = products.find(p => p.product_sku === productSku);
        const productMatch = !!product;

        // 檢查分類路徑是否存在
        const pathParts = categoryPath.split('/').map((p: string) => p.trim()).filter(Boolean);
        let pathMatch = true;
        let currentParentId: string | null = null;

        for (const part of pathParts) {
          const match = categories.find((c: any) => {
            if (c.name !== part) return false;
            if (currentParentId === null) {
              return !categoryHierarchy.some((h: any) => h.child_id === c.id);
            }
            return categoryHierarchy.some((h: any) => h.parent_id === currentParentId && h.child_id === c.id);
          });

          if (match) {
            currentParentId = match.id;
          } else {
            pathMatch = false;
            break;
          }
        }

        let status = 'success';
        let reason = '';

        if (!productMatch) {
          status = 'error';
          reason = `找不到產品 SKU：${productSku}`;
        } else if (!pathMatch) {
          status = 'error';
          reason = `分類路徑不存在：${categoryPath}`;
        } else if (variantSku) {
          const variant = product?.variants?.find((v: any) => v.sku === variantSku);
          if (!variant) {
            status = 'warning';
            reason = `找不到變體 SKU：${variantSku}`;
          }
        }

        return {
          _status: status,
          _reason: reason,
          product_sku: productSku,
          variant_sku: variantSku,
          category_path: categoryPath,
          product_name: product?.product_name || '',
        };
      });

      setPreviewData(previewRows);
      setParseResult(result.map((row: any) => ({
        product_sku: row['product_sku'] || row['產品SKU'] || '',
        variant_sku: row['variant_sku'] || row['變體SKU'] || '',
        category_path: row['category_path'] || row['分類路徑'] || '',
      })));
      setPreviewOpen(true);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      e.target.value = '';
    }
  };

  // 確認匯入
  const handleConfirmImport = async () => {
    if (!parseResult) return;
    setIsConfirming(true);

    try {
      const result = await batchImportBindings.mutateAsync(parseResult);
      setPreviewOpen(false);
      onOpenChange(false);
    } finally {
      setIsConfirming(false);
    }
  };

  // 匯出 CSV 範本
  const handleExportTemplate = () => {
    const template = [
      { product_sku: 'IMOS_GLA_CN', variant_sku: '', category_path: '玻璃保護貼/康寧系列' },
      { product_sku: 'IMOS_GLA_CN', variant_sku: 'IMOS_GLA_CN_18P_25D', category_path: '玻璃保護貼/康寧系列' },
    ];

    const csv = Papa.unparse(template);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '分類綁定匯入範本.csv';
    link.click();
  };

  const importColumns: ImportColumn[] = [
    {
      key: '_status', header: '狀態', width: '90px',
      render: (val: string) => {
        const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
          'success': { label: '成功', variant: 'default' },
          'warning': { label: '警告', variant: 'secondary' },
          'error': { label: '錯誤', variant: 'destructive' },
        };
        const m = map[val] || { label: val, variant: 'outline' as const };
        return <Badge variant={m.variant}>{m.label}</Badge>;
      },
    },
    { key: 'product_sku', header: '產品 SKU', width: '140px' },
    { key: 'product_name', header: '產品名稱', width: '160px' },
    { key: 'variant_sku', header: '變體 SKU', width: '140px' },
    { key: 'category_path', header: '分類路徑', width: '200px' },
    { key: '_reason', header: '備註', width: '200px' },
  ];

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImport}
        accept=".csv"
        className="hidden"
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批次匯入分類綁定</DialogTitle>
            <DialogDescription>
              上傳 CSV 檔案批次綁定分類到產品或變體
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              <p className="font-medium mb-2">CSV 欄位格式：</p>
              <ul className="list-disc list-inside space-y-1">
                <li><code>product_sku</code>（必要）- 產品 SKU</li>
                <li><code>variant_sku</code>（選填）- 變體 SKU，留空則綁定到產品層級</li>
                <li><code>category_path</code>（必要）- 分類路徑，例如「玻璃保護貼/康寧系列」</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportTemplate} className="flex-1">
                <Download className="mr-2 h-4 w-4" /> 下載範本
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} className="flex-1">
                <Upload className="mr-2 h-4 w-4" /> 選擇檔案
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportPreviewDialog
        open={previewOpen}
        onOpenChange={(open) => { if (!isConfirming) { setPreviewOpen(open); if (!open) setPreviewError(null); } }}
        title="分類綁定匯入預覽"
        description="請確認以下解析結果，確認無誤後按「確認匯入」寫入資料庫。"
        data={previewData}
        columns={importColumns}
        onConfirm={handleConfirmImport}
        isLoading={isConfirming}
        error={previewError}
        statusKey="_status"
      />
    </>
  );
}
