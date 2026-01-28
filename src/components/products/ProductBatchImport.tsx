import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Papa from 'papaparse';
import jschardet from 'jschardet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Upload, AlertCircle, Check, X, FileSpreadsheet, Pencil } from 'lucide-react';
import { toast } from 'sonner';

interface ImportRow {
  sku: string;
  name: string;
  description: string;
  category: string;
  base_wholesale_price: number;
  base_retail_price: number;
  status: 'active' | 'discontinued';
  errors: string[];
  isValid: boolean;
}

interface ProductBatchImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REQUIRED_FIELDS = ['sku', 'name'];
const OPTIONAL_FIELDS = ['description', 'category', 'base_wholesale_price', 'base_retail_price', 'status'];

export function ProductBatchImport({ open, onOpenChange }: ProductBatchImportProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'upload' | 'preview' | 'confirm'>('upload');
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});

  const resetState = () => {
    setStep('upload');
    setImportData([]);
    setEditingIndex(null);
    setHeaders([]);
    setFieldMapping({});
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const parseCSV = (text: string): string[][] => {
    const lines = text.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    });
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result;
      if (!(result instanceof ArrayBuffer)) return;

      // --- A. 自動偵測編碼 ---
      const uint8Array = new Uint8Array(result);
      const binaryString = Array.from(uint8Array.slice(0, 1000))
        .map(b => String.fromCharCode(b))
        .join('');

      const detection = jschardet.detect(binaryString);
      const encoding = detection.encoding || 'UTF-8';

      // --- B. 使用 PapaParse 解析 ---
      Papa.parse(file, {
        encoding: encoding,
        header: false, // 我們先用 array 模式讀取，方便做自動映射
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as string[][];

          if (rows.length < 2) {
            toast.error('CSV 檔案至少需要標題列和一筆資料');
            return;
          }

          const headerRow = rows[0].map(h => h.toLowerCase().trim());
          setHeaders(headerRow);

          // --- C. 自動映射欄位 (維持原本邏輯) ---
          const autoMapping: Record<string, string> = {};
          const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

          headerRow.forEach((header, index) => {
            const matchedField = allFields.find(f =>
              header === f ||
              header.replace(/_/g, ' ') === f.replace(/_/g, ' ') ||
              header.includes(f)
            );
            if (matchedField) {
              autoMapping[matchedField] = String(index);
            }
          });

          setFieldMapping(autoMapping);

          // --- D. 解析資料列 (轉換為 ImportRow 格式) ---
          const dataRows = rows.slice(1);
          const parsedData: ImportRow[] = dataRows.map(row => {
            const getField = (field: string): string => {
              const index = parseInt(autoMapping[field] ?? '-1');
              return index >= 0 && index < row.length ? row[index] : '';
            };

            const sku = getField('sku');
            const name = getField('name');
            const description = getField('description');
            const category = getField('category');
            const wholesalePrice = parseFloat(getField('base_wholesale_price')) || 0;
            const retailPrice = parseFloat(getField('base_retail_price')) || 0;
            const statusRaw = getField('status')?.toLowerCase();
            const status: 'active' | 'discontinued' = statusRaw === 'discontinued' ? 'discontinued' : 'active';

            const errors: string[] = [];
            if (!sku) errors.push('SKU 為必填');
            if (!name) errors.push('名稱為必填');

            return {
              sku,
              name,
              description,
              category,
              base_wholesale_price: wholesalePrice,
              base_retail_price: retailPrice,
              status,
              errors,
              isValid: errors.length === 0,
            };
          });

          setImportData(parsedData);
          setStep('preview');
        },
        error: (error) => {
          toast.error(`解析失敗：${error.message}`);
        }
      });
    };

    // 關鍵：使用 readAsArrayBuffer 才能偵測編碼
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);

  const updateRow = (index: number, field: keyof ImportRow, value: string | number) => {
    setImportData(prev => {
      const updated = [...prev];
      const row = { ...updated[index] };

      if (field === 'sku' || field === 'name' || field === 'description') {
        (row as any)[field] = value;
      } else if (field === 'base_wholesale_price' || field === 'base_retail_price') {
        (row as any)[field] = parseFloat(value as string) || 0;
      } else if (field === 'status') {
        row.status = value as 'active' | 'discontinued';
      }

      // 重新驗證
      const errors: string[] = [];
      if (!row.sku) errors.push('SKU 為必填');
      if (!row.name) errors.push('名稱為必填');
      row.errors = errors;
      row.isValid = errors.length === 0;

      updated[index] = row;
      return updated;
    });
  };

  const removeRow = (index: number) => {
    setImportData(prev => prev.filter((_, i) => i !== index));
  };

  const validRows = importData.filter(r => r.isValid);
  const invalidRows = importData.filter(r => !r.isValid);

  const importMutation = useMutation({
    mutationFn: async () => {
      const productsToInsert = validRows.map(row => ({
        sku: row.sku,
        name: row.name,
        description: row.description || null,
        category: row.category || null,
        base_wholesale_price: row.base_wholesale_price,
        base_retail_price: row.base_retail_price,
        status: row.status,
      }));

      const { error } = await supabase
        .from('products')
        .upsert(productsToInsert, { onConflict: 'sku' });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`成功匯入 ${validRows.length} 個產品`);
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(`匯入失敗：${error.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(v) : handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            批次匯入產品
            {step !== 'upload' && (
              <Badge variant="outline" className="ml-2">
                {step === 'preview' ? '預覽確認' : '最終確認'}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {step === 'upload' && (
            <div className="space-y-6 py-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">上傳 CSV 檔案</p>
                <p className="text-sm text-muted-foreground mb-4">
                  支援 CSV 格式，第一列需為標題列
                </p>
                <Label htmlFor="csv-upload" className="cursor-pointer">
                  <Input
                    id="csv-upload"
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button variant="outline" asChild>
                    <span>選擇檔案</span>
                  </Button>
                </Label>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <h4 className="font-medium mb-2">CSV 格式說明</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p><strong>必填欄位：</strong>sku, name</p>
                  <p><strong>選填欄位：</strong>description, base_wholesale_price, base_retail_price, status</p>
                  <p><strong>status 值：</strong>active 或 discontinued（預設為 active）</p>
                </div>
                <div className="mt-3 p-2 bg-background rounded font-mono text-xs">
                  sku,name,description,category,base_wholesale_price,base_retail_price,status<br />
                  SKU001,產品A,描述內容,類別,100,150,active<br />
                  SKU002,產品B,,80,120,active
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-4">
                <Badge variant="default" className="bg-success text-success-foreground">
                  <Check className="h-3 w-3 mr-1" />
                  有效 {validRows.length} 筆
                </Badge>
                {invalidRows.length > 0 && (
                  <Badge variant="destructive">
                    <X className="h-3 w-3 mr-1" />
                    錯誤 {invalidRows.length} 筆
                  </Badge>
                )}
              </div>

              <div className="rounded-lg border overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>名稱</TableHead>
                      <TableHead>描述</TableHead>
                      <TableHead>類別</TableHead>
                      <TableHead className="text-right">批發價</TableHead>
                      <TableHead className="text-right">零售價</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead className="w-20">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importData.map((row, index) => (
                      <TableRow key={index} className={!row.isValid ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          {row.isValid ? (
                            <Check className="h-4 w-4 text-success" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.sku}
                              onChange={(e) => updateRow(index, 'sku', e.target.value)}
                              className="h-8 w-24"
                            />
                          ) : (
                            <span className="font-mono text-sm">{row.sku || '-'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.name}
                              onChange={(e) => updateRow(index, 'name', e.target.value)}
                              className="h-8"
                            />
                          ) : (
                            row.name || '-'
                          )}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {editingIndex === index ? (
                            <Input
                              value={row.description}
                              onChange={(e) => updateRow(index, 'description', e.target.value)}
                              className="h-8"
                            />
                          ) : (
                            row.description || '-'
                          )}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {editingIndex === index ? (
                            <Input
                              value={row.category}
                              onChange={(e) => updateRow(index, 'category', e.target.value)}
                              className="h-8"
                            />
                          ) : (
                            row.category || '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingIndex === index ? (
                            <Input
                              type="number"
                              value={row.base_wholesale_price}
                              onChange={(e) => updateRow(index, 'base_wholesale_price', e.target.value)}
                              className="h-8 w-20 text-right"
                            />
                          ) : (
                            `$${row.base_wholesale_price.toFixed(2)}`
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingIndex === index ? (
                            <Input
                              type="number"
                              value={row.base_retail_price}
                              onChange={(e) => updateRow(index, 'base_retail_price', e.target.value)}
                              className="h-8 w-20 text-right"
                            />
                          ) : (
                            `$${row.base_retail_price.toFixed(2)}`
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Select
                              value={row.status}
                              onValueChange={(v) => updateRow(index, 'status', v)}
                            >
                              <SelectTrigger className="h-8 w-24">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">上架中</SelectItem>
                                <SelectItem value="discontinued">已停售</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                              {row.status === 'active' ? '上架中' : '已停售'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {editingIndex === index ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingIndex(null)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingIndex(index)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => removeRow(index)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {invalidRows.length > 0 && (
                <div className="bg-destructive/10 rounded-lg p-4">
                  <h4 className="font-medium text-destructive mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    錯誤詳情
                  </h4>
                  <ul className="text-sm space-y-1">
                    {invalidRows.map((row, i) => (
                      <li key={i}>
                        第 {importData.indexOf(row) + 1} 列：{row.errors.join('、')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              取消
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')}>
                重新上傳
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={validRows.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? '匯入中...' : `確認匯入 ${validRows.length} 筆`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
