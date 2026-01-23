import { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
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
import { Upload, AlertCircle, Check, X, FileSpreadsheet, Pencil, Layers } from 'lucide-react';
import { toast } from 'sonner';

interface ImportRow {
  product_sku: string;
  sku: string;
  name: string;
  option_1: string;
  option_2: string;
  option_3: string;
  wholesale_price: number;
  retail_price: number;
  barcode: string;
  status: 'active' | 'discontinued' | 'preorder' | 'sold_out';
  // 解析後附加的資料
  product_id?: string;
  errors: string[];
  isValid: boolean;
}

interface VariantBatchImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REQUIRED_FIELDS = ['product_sku', 'sku', 'name'];
const OPTIONAL_FIELDS = ['option_1', 'option_2', 'option_3', 'wholesale_price', 'retail_price', 'barcode', 'status'];

export function VariantBatchImport({ open, onOpenChange }: VariantBatchImportProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 取得所有產品用於 SKU 對應
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-import'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name')
        .order('sku');
      if (error) throw error;
      return data || [];
    },
  });

  const productSkuMap = new Map(products.map(p => [p.sku.toLowerCase(), p]));

  const resetState = () => {
    setStep('upload');
    setImportData([]);
    setEditingIndex(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const validateRow = (row: Omit<ImportRow, 'errors' | 'isValid' | 'product_id'>): { errors: string[]; product_id?: string } => {
    const errors: string[] = [];
    let product_id: string | undefined;

    if (!row.product_sku) {
      errors.push('主產品 SKU 為必填');
    } else {
      const product = productSkuMap.get(row.product_sku.toLowerCase());
      if (!product) {
        errors.push(`找不到主產品 SKU: ${row.product_sku}`);
      } else {
        product_id = product.id;
      }
    }

    if (!row.sku) errors.push('變體 SKU 為必填');
    if (!row.name) errors.push('變體名稱為必填');

    return { errors, product_id };
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (event) => {
      const result = event.target?.result;
      if (!(result instanceof ArrayBuffer)) return;

      const uint8Array = new Uint8Array(result);
      const binaryString = Array.from(uint8Array.slice(0, 1000))
        .map(b => String.fromCharCode(b))
        .join('');

      const detection = jschardet.detect(binaryString);
      const encoding = detection.encoding || 'UTF-8';

      Papa.parse(file, {
        encoding: encoding,
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data as string[][];

          if (rows.length < 2) {
            toast.error('CSV 檔案至少需要標題列和一筆資料');
            return;
          }

          const headerRow = rows[0].map(h => h.toLowerCase().trim());

          // 自動映射欄位
          const autoMapping: Record<string, number> = {};
          const allFields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

          headerRow.forEach((header, index) => {
            const matchedField = allFields.find(f =>
              header === f ||
              header.replace(/_/g, ' ') === f.replace(/_/g, ' ') ||
              header.includes(f)
            );
            if (matchedField) {
              autoMapping[matchedField] = index;
            }
          });

          // 解析資料列
          const dataRows = rows.slice(1);
          const parsedData: ImportRow[] = dataRows.map(row => {
            const getField = (field: string): string => {
              const index = autoMapping[field] ?? -1;
              return index >= 0 && index < row.length ? row[index].trim() : '';
            };

            const product_sku = getField('product_sku');
            const sku = getField('sku');
            const name = getField('name');
            const option_1 = getField('option_1');
            const option_2 = getField('option_2');
            const option_3 = getField('option_3');
            const wholesale_price = parseFloat(getField('wholesale_price')) || 0;
            const retail_price = parseFloat(getField('retail_price')) || 0;
            const barcode = getField('barcode');
            const statusRaw = getField('status')?.toLowerCase();
            const status = (['active', 'discontinued', 'preorder', 'sold_out'].includes(statusRaw) 
              ? statusRaw 
              : 'active') as ImportRow['status'];

            const baseRow = {
              product_sku,
              sku,
              name,
              option_1,
              option_2,
              option_3,
              wholesale_price,
              retail_price,
              barcode,
              status,
            };

            const { errors, product_id } = validateRow(baseRow);

            return {
              ...baseRow,
              product_id,
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

    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, [productSkuMap]);

  const updateRow = (index: number, field: keyof ImportRow, value: string | number) => {
    setImportData(prev => {
      const updated = [...prev];
      const row = { ...updated[index] };

      if (field === 'product_sku' || field === 'sku' || field === 'name' || 
          field === 'option_1' || field === 'option_2' || field === 'option_3' || field === 'barcode') {
        (row as any)[field] = value;
      } else if (field === 'wholesale_price' || field === 'retail_price') {
        (row as any)[field] = parseFloat(value as string) || 0;
      } else if (field === 'status') {
        row.status = value as ImportRow['status'];
      }

      // 重新驗證
      const { errors, product_id } = validateRow(row);
      row.errors = errors;
      row.isValid = errors.length === 0;
      row.product_id = product_id;

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
      // 插入變體
      const variantsToInsert = validRows.map(row => ({
        product_id: row.product_id!,
        sku: row.sku,
        name: row.name,
        option_1: row.option_1 || null,
        option_2: row.option_2 || null,
        option_3: row.option_3 || null,
        wholesale_price: row.wholesale_price,
        retail_price: row.retail_price,
        barcode: row.barcode || null,
        status: row.status,
      }));

      const { error } = await supabase
        .from('product_variants')
        .upsert(variantsToInsert, { onConflict: 'sku' });

      if (error) throw error;

      // 更新產品的 has_variants 標記
      const productIds = [...new Set(validRows.map(r => r.product_id!))];
      if (productIds.length > 0) {
        const { error: updateError } = await supabase
          .from('products')
          .update({ has_variants: true })
          .in('id', productIds);

        if (updateError) {
          console.warn('更新 has_variants 失敗:', updateError);
        }
      }
    },
    onSuccess: () => {
      toast.success(`成功匯入 ${validRows.length} 個變體`);
      queryClient.invalidateQueries({ queryKey: ['products-with-cache'] });
      queryClient.invalidateQueries({ queryKey: ['all-active-variants'] });
      queryClient.invalidateQueries({ queryKey: ['all-product-variants'] });
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(`匯入失敗：${error.message}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(v) : handleClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            批次匯入變體
            {step === 'preview' && (
              <Badge variant="outline" className="ml-2">預覽確認</Badge>
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
                <Label htmlFor="variant-csv-upload" className="cursor-pointer">
                  <Input
                    id="variant-csv-upload"
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
                  <p><strong>必填欄位：</strong>product_sku, sku, name</p>
                  <p><strong>選填欄位：</strong>option_1, option_2, option_3, wholesale_price, retail_price, barcode, status</p>
                  <p><strong>status 值：</strong>active, discontinued, preorder, sold_out（預設為 active）</p>
                  <p><strong>注意：</strong>product_sku 必須對應已存在的主產品 SKU</p>
                </div>
                <div className="mt-3 p-2 bg-background rounded font-mono text-xs overflow-x-auto">
                  product_sku,sku,name,option_1,option_2,wholesale_price,retail_price,status<br />
                  MAIN-001,MAIN-001-RED-S,紅色 S,紅色,S,100,150,active<br />
                  MAIN-001,MAIN-001-RED-M,紅色 M,紅色,M,100,150,active<br />
                  MAIN-001,MAIN-001-BLUE-S,藍色 S,藍色,S,100,150,active
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
                      <TableHead>主產品 SKU</TableHead>
                      <TableHead>變體 SKU</TableHead>
                      <TableHead>名稱</TableHead>
                      <TableHead>選項 1</TableHead>
                      <TableHead>選項 2</TableHead>
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
                            <div className="flex items-center gap-1">
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <span className="text-xs text-destructive max-w-[100px] truncate" title={row.errors.join(', ')}>
                                {row.errors[0]}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.product_sku}
                              onChange={(e) => updateRow(index, 'product_sku', e.target.value)}
                              className="h-8 w-24"
                            />
                          ) : (
                            <span className="font-mono text-sm">{row.product_sku || '-'}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.sku}
                              onChange={(e) => updateRow(index, 'sku', e.target.value)}
                              className="h-8 w-28"
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
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.option_1}
                              onChange={(e) => updateRow(index, 'option_1', e.target.value)}
                              className="h-8 w-16"
                            />
                          ) : (
                            row.option_1 || '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {editingIndex === index ? (
                            <Input
                              value={row.option_2}
                              onChange={(e) => updateRow(index, 'option_2', e.target.value)}
                              className="h-8 w-16"
                            />
                          ) : (
                            row.option_2 || '-'
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingIndex === index ? (
                            <Input
                              type="number"
                              value={row.wholesale_price}
                              onChange={(e) => updateRow(index, 'wholesale_price', e.target.value)}
                              className="h-8 w-20 text-right"
                            />
                          ) : (
                            `$${row.wholesale_price}`
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingIndex === index ? (
                            <Input
                              type="number"
                              value={row.retail_price}
                              onChange={(e) => updateRow(index, 'retail_price', e.target.value)}
                              className="h-8 w-20 text-right"
                            />
                          ) : (
                            `$${row.retail_price}`
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
                                <SelectItem value="preorder">預購</SelectItem>
                                <SelectItem value="sold_out">售完</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                              {row.status === 'active' ? '上架中' : 
                               row.status === 'discontinued' ? '已停售' :
                               row.status === 'preorder' ? '預購' : '售完'}
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
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            取消
          </Button>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={resetState}>
                重新上傳
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={validRows.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? '匯入中...' : `確認匯入 ${validRows.length} 個變體`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
