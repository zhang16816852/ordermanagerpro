import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Download, FileText, FileSpreadsheet } from 'lucide-react';
import * as xlsx from 'xlsx';
import { exportToCSV } from '@/lib/exportUtils';
import { SupplierProductMapping } from '../../hooks/useSupplierMappings';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

interface MappingExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mappings: SupplierProductMapping[];
  supplierName: string;
}

export function MappingExportDialog({
  open,
  onOpenChange,
  mappings,
  supplierName,
}: MappingExportDialogProps) {
  const [format, setFormat] = useState<'csv' | 'excel'>('csv');

  const handleExport = () => {
    const data = mappings.map(m => ({
      '類型': m.internal_variant_id ? '變體' : '產品',
      '內部SKU': m.internal_variant?.sku || m.internal_product?.sku || '',
      '內部產品名稱': m.internal_product?.name || '',
      '內部變體名稱': m.internal_variant?.name || '',
      '廠商代號': m.vendor_product_id,
      '廠商品名': m.vendor_product_name || '',
      '單價': m.vendor_unit_cost ?? '',
    }));

    const filename = `產品對照_${supplierName}`;

    if (format === 'csv') {
      exportToCSV(data, filename);
    } else {
      const ws = xlsx.utils.json_to_sheet(data);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, '產品對照');
      xlsx.writeFile(wb, `${filename}_${Date.now()}.xlsx`);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            匯出產品對照
          </DialogTitle>
          <DialogDescription>
            將 {supplierName} 的 {mappings.length} 筆對照規則匯出
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>匯出格式</Label>
            <div className="flex gap-2">
              <Button
                variant={format === 'csv' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFormat('csv')}
                className="flex-1"
              >
                <FileText className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button
                variant={format === 'excel' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFormat('excel')}
                className="flex-1"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
            <p className="font-medium mb-1">匯出欄位：</p>
            <p>類型、內部SKU、內部產品名稱、內部變體名稱、廠商代號、廠商品名、單價</p>
            <p className="text-xs mt-1">匯出的檔案可用於重新匯入對照資料</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> 匯出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
