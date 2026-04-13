import { useState, useRef } from 'react';
import * as xlsx from 'xlsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSupplierMappings } from '../hooks/useSupplierMappings';
import { SupplierMappingManager } from './mapping/SupplierMappingManager';
import { Upload, AlertTriangle } from 'lucide-react';

interface ExcelImportDialogProps {
  supplierId: string;
  onImport: (items: any[]) => void;
  isLoading?: boolean;
}

export function ExcelImportDialog({ supplierId, onImport, isLoading }: ExcelImportDialogProps) {
  const { config, mappings, isLoadingConfig, isLoadingMappings } = useSupplierMappings(supplierId);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [unmappedItems, setUnmappedItems] = useState<any[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleConfirmImport = () => {
    const validItems = parsedData.filter(i => i.internal_product_id);
    const finalItems = validItems.map(i => ({
      product_id: i.internal_product_id,
      variant_id: i.internal_variant_id || null, // Optional payload
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    }));
    
    onImport(finalItems);
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
              <p className="text-sm font-medium">成功解析且無未對應項目 ({parsedData.length} 筆)</p>
              <div className="max-h-[300px] overflow-y-auto border rounded-md p-2">
                 <table className="w-full text-sm">
                   <thead>
                     <tr className="border-b"><th className="text-left p-1">外部代號</th><th className="text-left p-1">品名</th><th className="text-right p-1">數量</th><th className="text-right p-1">單價</th></tr>
                   </thead>
                   <tbody>
                     {parsedData.map((row, i) => (
                       <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
                         <td className="p-1">{row.vendor_product_id}</td>
                         <td className="p-1">{row.vendor_product_name}</td>
                         <td className="p-1 text-right">{row.quantity}</td>
                         <td className="p-1 text-right">{row.unit_cost}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
              </div>
              <div className="flex justify-end pt-4">
                <Button onClick={handleConfirmImport} disabled={isLoading}>
                  確定寫入採購清單 ({parsedData.length} 筆)
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
