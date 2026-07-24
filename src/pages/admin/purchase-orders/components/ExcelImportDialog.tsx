import { useState, useRef } from 'react';
import * as xlsx from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSupplierMappings } from '../hooks/useSupplierMappings';
import { SupplierMappingManager } from './mapping/SupplierMappingManager';
import { Upload, AlertTriangle } from 'lucide-react';
import { ImportPreviewDialog, ImportColumn } from '@/components/shared/ImportPreviewDialog';

interface ExcelImportDialogProps {
  supplierId: string;
  supplierName: string;
  onImport: (items: any[]) => void;
  isLoading?: boolean;
}

export function ExcelImportDialog({ supplierId, supplierName, onImport, isLoading }: ExcelImportDialogProps) {
  const { config, mappings, isLoadingConfig, isLoadingMappings } = useSupplierMappings(supplierId);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [unmappedItems, setUnmappedItems] = useState<any[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewColumns: ImportColumn[] = [
    { key: 'vendor_product_id', header: '外部代號', width: '150px' },
    { key: 'vendor_product_name', header: '品名', width: '200px' },
    { key: 'quantity', header: '數量', width: '80px', align: 'right' },
    { key: 'unit_cost', header: '單價', width: '100px', align: 'right' },
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFile(file);
    parseExcel(file, mappings);
  };

  const parseExcel = async (file: File, currentMappings: any) => {
    if (!config) {
      alert('請先在供應商管理中設定 Excel 匯入欄位對應！');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = xlsx.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const json = xlsx.utils.sheet_to_json(worksheet, { 
        header: 1, 
        blankrows: false 
      }) as any[][];

      const headerRowIndex = config.header_row || 0;
      if (json.length <= headerRowIndex + 1) {
        alert('解析失敗：檔案內容不足或表頭設定不正確');
        return;
      }

      const headers = json[headerRowIndex];
      const rows = json.slice(headerRowIndex + 1);

      const mappingRules = config.mapping_config;
      const vendorIdIdx = headers.indexOf(mappingRules.vendor_product_id);
      const vendorNameIdx = headers.indexOf(mappingRules.vendor_product_name);
      const qtyIdx = headers.indexOf(mappingRules.quantity);
      const costIdx = headers.indexOf(mappingRules.unit_cost);

      if (vendorIdIdx === -1) {
        alert(`解析失敗：找不到設定的廠商產品代號欄位「${mappingRules.vendor_product_id}」`);
        return;
      }

      const parsedItems = rows.map((row) => ({
        vendor_product_id: String(row[vendorIdIdx]),
        vendor_product_name: vendorNameIdx !== -1 ? String(row[vendorNameIdx] || '') : '',
        quantity: qtyIdx !== -1 ? Number(row[qtyIdx]) : 1,
        unit_cost: costIdx !== -1 ? Number(row[costIdx]) : 0,
      })).filter(i => i.vendor_product_id && i.vendor_product_id !== 'undefined');

      checkMappings(parsedItems, currentMappings);
    };
    reader.readAsArrayBuffer(file);
  };

  const checkMappings = (items: any[], currentMappings: any[]) => {
    const unmapped: any[] = [];
    
    const preparedData = items.map(item => {
      const match = currentMappings.find(m => String(m.vendor_product_id) === String(item.vendor_product_id));
      if (!match) {
        if (!unmapped.find(u => u.vendor_product_id === item.vendor_product_id)) {
          unmapped.push({
            vendor_product_id: item.vendor_product_id,
            vendor_product_name: item.vendor_product_name,
          });
        }
      }
      return {
        ...item,
        internal_product_id: match?.internal_product_id,
        internal_variant_id: match?.internal_variant_id,
      };
    });

    setParsedData(preparedData);
    setUnmappedItems(unmapped);
    
    if (unmapped.length > 0) {
      setIsResolving(true);
    } else {
      setIsResolving(false);
    }
  };

  const handleShowPreview = () => {
    const hasUnmapped = parsedData.some(i => !i.internal_product_id);
    if (hasUnmapped) {
      setPreviewError('尚有未對應的廠商產品，請先完成對應後再匯入。');
      return;
    }
    setPreviewError(null);
    setPreviewOpen(true);
  };

  const handleConfirmImport = () => {
    const validItems = parsedData.filter(i => i.internal_product_id);
    const finalItems = validItems.map(i => ({
      product_id: i.internal_product_id,
      variant_id: i.internal_variant_id || null,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    }));
    
    setIsConfirming(true);
    try {
      onImport(finalItems);
      setPreviewOpen(false);
    } catch (err: any) {
      setPreviewError(err.message);
    } finally {
      setIsConfirming(false);
    }
  };

  if (isLoadingConfig || isLoadingMappings) {
    return <div className="p-4 text-center">載入供應商設定中...</div>;
  }

  return (
    <div className="space-y-4">
      {!config ? (
        <div className="bg-red-50 text-red-600 p-4 rounded-md flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 mt-0.5" />
          <div>
            <p className="font-bold">尚未設定匯入規則</p>
            <p className="text-sm">請先至「供應商管理 &gt; 對照管理」設定此廠商的 Excel 欄位對應規則，才能使用檔案匯入功能。</p>
          </div>
        </div>
      ) : (
        <>
          {!isResolving && (
            <div className="flex gap-4">
              <Input 
                type="file" 
                accept=".xls,.xlsx" 
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="flex-1"
              />
            </div>
          )}

          {isResolving ? (
            <div className="border rounded-md p-4 bg-muted/20">
              <SupplierMappingManager 
                supplierId={supplierId} 
                supplierName={supplierName}
                unmappedItems={unmappedItems}
                onAllUnmappedResolved={() => {
                  alert('對應成功，請按下重試按鈕重新解析 Excel 以套用新對應！');
                  setIsResolving(false);
                }} 
              />
              <div className="mt-4 flex justify-end">
                <Button variant="outline" onClick={() => {
                  if (file) parseExcel(file, mappings);
                }}>
                  套用對應並重新解析
                </Button>
              </div>
            </div>
          ) : parsedData.length > 0 ? (
            <div className="space-y-4 pt-4 border-t">
              <p className="text-sm font-medium text-green-600">
                成功解析 {parsedData.length} 筆（已全數對應）
              </p>
              <div className="flex justify-end pt-2">
                <Button onClick={handleShowPreview} variant="default">
                  預覽匯入資料 ({parsedData.length} 筆)
                </Button>
              </div>
            </div>
          ) : null}

          <ImportPreviewDialog
            open={previewOpen}
            onOpenChange={(open) => { if (!isConfirming) { setPreviewOpen(open); if (!open) setPreviewError(null); } }}
            title="採購單匯入預覽"
            description="請確認以下解析結果，確認無誤後按「確認匯入」寫入採購清單。"
            data={parsedData}
            columns={previewColumns}
            onConfirm={handleConfirmImport}
            isLoading={isConfirming || !!isLoading}
            error={previewError}
            confirmText="確認寫入採購清單"
          />
        </>
      )}
    </div>
  );
}
