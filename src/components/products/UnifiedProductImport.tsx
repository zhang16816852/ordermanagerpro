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
import { Upload, AlertCircle, Check, X, FileSpreadsheet, Pencil, Info, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ImportRow {
    // 主產品欄位
    product_sku: string;
    product_name: string;
    description: string;
    category: string;
    brand: string;
    model: string;
    series: string;
    base_wholesale_price: number;
    base_retail_price: number;
    product_status: 'active' | 'discontinued' | 'preorder' | 'sold_out';

    // 變體欄位（選填）
    variant_sku?: string;
    variant_name?: string;
    option_1?: string;
    option_2?: string;
    option_3?: string;
    variant_wholesale_price?: number;
    variant_retail_price?: number;
    variant_status?: 'active' | 'discontinued' | 'preorder' | 'sold_out';
    barcode?: string;

    // 內部使用
    hasVariant: boolean;
    errors: string[];
    isValid: boolean;
}

interface UnifiedProductImportProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const PRODUCT_REQUIRED = ['product_sku', 'product_name'];
const PRODUCT_OPTIONAL = ['description', 'category', 'brand', 'model', 'series', 'base_wholesale_price', 'base_retail_price', 'product_status'];
const VARIANT_FIELDS = ['variant_sku', 'variant_name', 'option_1', 'option_2', 'option_3', 'variant_wholesale_price', 'variant_retail_price', 'variant_status', 'barcode'];

export function UnifiedProductImport({ open, onOpenChange }: UnifiedProductImportProps) {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<'upload' | 'preview'>('upload');
    const [importData, setImportData] = useState<ImportRow[]>([]);

    const resetState = () => {
        setStep('upload');
        setImportData([]);
    };

    const handleClose = () => {
        resetState();
        onOpenChange(false);
    };

    // 下載統一範本函數
    const downloadTemplate = () => {
        // 統一範本包含所有欄位，使用者可以選擇性填寫
        const csvContent = [
            'product_sku,product_name,description,category,brand,model,series,base_wholesale_price,base_retail_price,product_status,variant_sku,variant_name,option_1,option_2,option_3,variant_wholesale_price,variant_retail_price,variant_status,barcode',
            '# 範例1：純產品（不填寫 variant_* 欄位）',
            'PROD-001,基本款T恤,純棉舒適T恤,服飾,100,150,active,,,,,,,,,',
            'PROD-002,經典牛仔褲,耐穿牛仔褲,服飾,200,300,active,,,,,,,,,',
            '',
            '# 範例2：產品+變體（填寫 variant_* 欄位，同一產品可重複多列）',
            'SHIRT-001,彩色襯衫,舒適透氣的彩色襯衫,服飾,100,150,active,SHIRT-001-RED-S,紅色 S,紅色,S,,,,,',
            'SHIRT-001,彩色襯衫,舒適透氣的彩色襯衫,服飾,100,150,active,SHIRT-001-RED-M,紅色 M,紅色,M,,,,,',
            'SHIRT-001,彩色襯衫,舒適透氣的彩色襯衫,服飾,100,150,active,SHIRT-001-BLUE-S,藍色 S,藍色,S,,,,,',
        ].join('\n');

        const filename = '產品匯入範本.csv';

        // 加上 BOM 以確保 Excel 正確識別 UTF-8
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success(`已下載範本：${filename}`);
    };

    const validateRow = (row: Omit<ImportRow, 'errors' | 'isValid' | 'hasVariant'>): { errors: string[]; hasVariant: boolean } => {
        const errors: string[] = [];

        // 驗證主產品必填欄位
        if (!row.product_sku) errors.push('產品 SKU 為必填');
        if (!row.product_name) errors.push('產品名稱為必填');

        // 判斷是否有變體資料
        const hasVariant = !!(row.variant_sku || row.variant_name);

        // 如果有變體，驗證變體必填欄位
        if (hasVariant) {
            if (!row.variant_sku) errors.push('變體 SKU 為必填（當有變體資料時）');
            if (!row.variant_name) errors.push('變體名稱為必填（當有變體資料時）');
        }

        return { errors, hasVariant };
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
                    const allFields = [...PRODUCT_REQUIRED, ...PRODUCT_OPTIONAL, ...VARIANT_FIELDS];

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
                        const product_name = getField('product_name');
                        const brand = getField('brand');
                        const model = getField('model');
                        const series = getField('series');
                        const description = getField('description');
                        const category = getField('category');
                        const base_wholesale_price = parseFloat(getField('base_wholesale_price')) || 0;
                        const base_retail_price = parseFloat(getField('base_retail_price')) || 0;
                        const productStatusRaw = getField('product_status')?.toLowerCase();
                        const product_status = (['active', 'discontinued', 'preorder', 'sold_out'].includes(productStatusRaw)
                            ? productStatusRaw
                            : 'active') as ImportRow['product_status'];

                        // 變體欄位
                        const variant_sku = getField('variant_sku');
                        const variant_name = getField('variant_name');
                        const option_1 = getField('option_1');
                        const option_2 = getField('option_2');
                        const option_3 = getField('option_3');
                        const variant_wholesale_price = parseFloat(getField('variant_wholesale_price')) || undefined;
                        const variant_retail_price = parseFloat(getField('variant_retail_price')) || undefined;
                        const variantStatusRaw = getField('variant_status')?.toLowerCase();
                        const variant_status = (['active', 'discontinued', 'preorder', 'sold_out'].includes(variantStatusRaw)
                            ? variantStatusRaw
                            : undefined) as ImportRow['variant_status'];
                        const barcode = getField('barcode');

                        const baseRow = {
                            product_sku,
                            product_name,
                            brand,
                            model,
                            series,
                            description,
                            category,
                            base_wholesale_price,
                            base_retail_price,
                            product_status,
                            variant_sku,
                            variant_name,
                            option_1,
                            option_2,
                            option_3,
                            variant_wholesale_price,
                            variant_retail_price,
                            variant_status,
                            barcode,
                        };

                        const { errors, hasVariant } = validateRow(baseRow);

                        return {
                            ...baseRow,
                            hasVariant,
                            errors,
                            isValid: errors.length === 0,
                        };
                    });

                    // 檢測重複的 SKU
                    const productSkuCount = new Map<string, number>();
                    const variantSkuCount = new Map<string, number>();

                    parsedData.forEach(row => {
                        // 計算 product_sku 出現次數（僅在純產品模式下）
                        if (row.product_sku && !row.hasVariant) {
                            productSkuCount.set(row.product_sku, (productSkuCount.get(row.product_sku) || 0) + 1);
                        }
                        // 計算 variant_sku 出現次數
                        if (row.variant_sku) {
                            variantSkuCount.set(row.variant_sku, (variantSkuCount.get(row.variant_sku) || 0) + 1);
                        }
                    });

                    // 標記重複的 SKU 為錯誤
                    parsedData.forEach(row => {
                        // 純產品模式下，product_sku 不應重複
                        if (!row.hasVariant) {
                            const productCount = productSkuCount.get(row.product_sku) || 0;
                            if (productCount > 1) {
                                row.errors.push(`產品 SKU "${row.product_sku}" 重複出現 ${productCount} 次（純產品模式）`);
                                row.isValid = false;
                            }
                        }

                        // 變體 SKU 不應重複
                        if (row.variant_sku) {
                            const variantCount = variantSkuCount.get(row.variant_sku) || 0;
                            if (variantCount > 1) {
                                row.errors.push(`變體 SKU "${row.variant_sku}" 重複出現 ${variantCount} 次`);
                                row.isValid = false;
                            }
                        }
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
    }, []);

    const updateRow = (index: number, field: keyof ImportRow, value: string | number) => {
        setImportData(prev => {
            const updated = [...prev];
            const row = { ...updated[index] };

            // 更新欄位值
            (row as any)[field] = value;

            // 重新驗證
            const { errors, hasVariant } = validateRow(row);
            row.errors = errors;
            row.isValid = errors.length === 0;
            row.hasVariant = hasVariant;

            updated[index] = row;
            return updated;
        });
    };

    const removeRow = (index: number) => {
        setImportData(prev => prev.filter((_, i) => i !== index));
    };

    const validRows = importData.filter(r => r.isValid);
    const invalidRows = importData.filter(r => !r.isValid);
    const productsWithVariants = validRows.filter(r => r.hasVariant);
    const productsWithoutVariants = validRows.filter(r => !r.hasVariant);
    function normalizeBarcode(value: any): string {
        if (!value) return '';

        // 如果是科學記號
        if (typeof value === 'number') {
            return value.toLocaleString('fullwide', { useGrouping: false });
        }

        const str = String(value);

        // 科學記號字串 → 轉回
        if (/e\+/i.test(str)) {
            return Number(str)
                .toLocaleString('fullwide', { useGrouping: false });
        }

        return str.trim();
    }

    const importMutation = useMutation({
        mutationFn: async () => {
            // 第一步：匯入所有主產品（去重）
            const uniqueProducts = new Map<string, ImportRow>();
            validRows.forEach(row => {
                if (!uniqueProducts.has(row.product_sku)) {
                    uniqueProducts.set(row.product_sku, row);
                }
            });

            const productsToInsert = Array.from(uniqueProducts.values()).map(row => ({
                sku: row.product_sku,
                name: row.product_name,
                description: row.description || null,
                model: row.option_2 || null,
                series: row.series || null,
                brand: row.brand || null,
                category: row.category || null,
                base_wholesale_price: row.base_wholesale_price,
                base_retail_price: row.base_retail_price,
                status: row.product_status,
                has_variants: row.hasVariant,
            }));

            const { error: productError } = await supabase
                .from('products')
                .upsert(productsToInsert, { onConflict: 'sku' });

            if (productError) throw productError;

            // 第二步：如果有變體，匯入變體
            if (productsWithVariants.length > 0) {
                // 取得產品 ID 映射
                const { data: products, error: fetchError } = await supabase
                    .from('products')
                    .select('id, sku')
                    .in('sku', Array.from(uniqueProducts.keys()));

                if (fetchError) throw fetchError;

                const productIdMap = new Map(products?.map(p => [p.sku, p.id]) || []);

                // 因為已在預覽階段檢測重複，這裡不需要再去重
                const variantsToInsert = productsWithVariants.map(row => ({
                    product_id: productIdMap.get(row.product_sku)!,
                    sku: row.variant_sku!,
                    name: row.variant_name!,
                    option_1: row.option_1 || null,
                    option_2: row.option_2 || null,
                    option_3: row.option_3 || null,
                    wholesale_price: row.variant_wholesale_price || row.base_wholesale_price,
                    retail_price: row.variant_retail_price || row.base_retail_price,
                    barcode: normalizeBarcode(row.barcode) || null,
                    status: row.variant_status || row.product_status,
                }));

                const { error: variantError } = await supabase
                    .from('product_variants')
                    .upsert(variantsToInsert, { onConflict: 'sku' });

                if (variantError) throw variantError;
            }
        },
        onSuccess: () => {
            const productCount = new Set(validRows.map(r => r.product_sku)).size;
            const variantCount = new Set(
                productsWithVariants
                    .filter(r => r.variant_sku)
                    .map(r => r.variant_sku)
            ).size;

            if (variantCount > 0) {
                toast.success(`成功匯入 ${productCount} 個產品與 ${variantCount} 個變體`);
            } else {
                toast.success(`成功匯入 ${productCount} 個產品`);
            }

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
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" />
                        批次匯入產品與變體
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
                                    支援同時匯入產品與變體，第一列需為標題列
                                </p>
                                <Label htmlFor="unified-csv-upload" className="cursor-pointer">
                                    <Input
                                        id="unified-csv-upload"
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

                            {/* 下載範本區域 */}
                            <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
                                <h4 className="font-medium mb-3 flex items-center gap-2">
                                    <Download className="h-4 w-4" />
                                    下載範本檔案
                                </h4>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={downloadTemplate}
                                    className="w-full"
                                >
                                    <Download className="h-4 w-4 mr-2" />
                                    下載統一範本（包含產品與變體範例）
                                </Button>
                                <p className="text-xs text-muted-foreground mt-2">
                                    範本包含純產品和產品+變體兩種範例，系統會自動判斷匯入類型
                                </p>
                            </div>

                            <Alert>
                                <Info className="h-4 w-4" />
                                <AlertDescription>
                                    <strong>支援兩種匯入模式：</strong>
                                    <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                                        <li><strong>純產品模式</strong>：只填寫 product_* 欄位，不填寫 variant_* 欄位</li>
                                        <li><strong>產品+變體模式</strong>：同時填寫 product_* 和 variant_* 欄位</li>
                                    </ul>
                                </AlertDescription>
                            </Alert>

                            <div className="bg-muted/50 rounded-lg p-4">
                                <h4 className="font-medium mb-2">CSV 格式說明</h4>
                                <div className="text-sm text-muted-foreground space-y-2">
                                    <div>
                                        <p><strong>產品必填欄位：</strong>product_sku, product_name</p>
                                        <p><strong>產品選填欄位：</strong>description, category,brand, base_wholesale_price, base_retail_price, product_status</p>
                                    </div>
                                    <div>
                                        <p><strong>變體欄位（選填）：</strong>variant_sku, variant_name, option_1, option_2, option_3, variant_wholesale_price, variant_retail_price, variant_status, barcode</p>
                                        <p className="text-xs mt-1">註：如果填寫了 variant_sku 或 variant_name，則兩者都必填</p>
                                    </div>
                                    <div>
                                        <p><strong>status 值：</strong>active, discontinued, preorder, sold_out（預設為 active）</p>
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2">
                                    <p className="text-sm font-medium">範例 1：純產品匯入</p>
                                    <div className="p-2 bg-background rounded font-mono text-xs overflow-x-auto">
                                        product_sku,product_name,category,base_wholesale_price,base_retail_price<br />
                                        PROD-001,基本款T恤,服飾,100,150<br />
                                        PROD-002,經典牛仔褲,服飾,200,300
                                    </div>
                                </div>

                                <div className="mt-4 space-y-2">
                                    <p className="text-sm font-medium">範例 2：產品+變體匯入</p>
                                    <div className="p-2 bg-background rounded font-mono text-xs overflow-x-auto">
                                        product_sku,product_name,base_wholesale_price,base_retail_price,variant_sku,variant_name,option_1,option_2<br />
                                        SHIRT-001,彩色襯衫,100,150,SHIRT-001-RED-S,紅色 S,紅色,S<br />
                                        SHIRT-001,彩色襯衫,100,150,SHIRT-001-RED-M,紅色 M,紅色,M<br />
                                        SHIRT-001,彩色襯衫,100,150,SHIRT-001-BLUE-S,藍色 S,藍色,S
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        註：同一個產品的多個變體，product_* 欄位可以重複，系統會自動去重
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'preview' && (
                        <div className="space-y-4 py-4">
                            <div className="flex items-center gap-4 flex-wrap">
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
                                <Badge variant="outline">
                                    產品 {new Set(validRows.map(r => r.product_sku)).size} 個
                                </Badge>
                                {productsWithVariants.length > 0 && (
                                    <Badge variant="outline">
                                        變體 {productsWithVariants.length} 個
                                    </Badge>
                                )}
                            </div>

                            <div className="rounded-lg border overflow-auto max-h-[500px]">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background">
                                        <TableRow>
                                            <TableHead className="w-12">#</TableHead>
                                            <TableHead>產品SKU</TableHead>
                                            <TableHead>產品名稱</TableHead>
                                            <TableHead>品牌</TableHead>
                                            <TableHead>類別</TableHead>
                                            <TableHead className="text-right">批發/零售</TableHead>
                                            <TableHead>變體SKU</TableHead>
                                            <TableHead>變體名稱</TableHead>
                                            <TableHead>選項</TableHead>
                                            <TableHead className="w-20">操作</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {importData.map((row, index) => (
                                            <TableRow key={index} className={!row.isValid ? 'bg-destructive/10' : ''}>
                                                <TableCell>
                                                    {row.isValid ? (
                                                        <div className="flex items-center gap-1">
                                                            <Check className="h-4 w-4 text-success" />
                                                            {row.hasVariant && <Badge variant="secondary" className="text-[10px] px-1">V</Badge>}
                                                        </div>
                                                    ) : (
                                                        <AlertCircle className="h-4 w-4 text-destructive" />
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.product_sku}
                                                        onChange={(e) => updateRow(index, 'product_sku', e.target.value)}
                                                        className="h-7 font-mono text-xs"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.product_name}
                                                        onChange={(e) => updateRow(index, 'product_name', e.target.value)}
                                                        className="h-7 text-sm"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.brand}
                                                        onChange={(e) => updateRow(index, 'brand', e.target.value)}
                                                        className="h-7 text-sm"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.series}
                                                        onChange={(e) => updateRow(index, 'series', e.target.value)}
                                                        className="h-7 text-sm"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.category}
                                                        onChange={(e) => updateRow(index, 'category', e.target.value)}
                                                        className="h-7 text-sm"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex gap-1 items-center">
                                                        <Input
                                                            type="number"
                                                            value={row.base_wholesale_price}
                                                            onChange={(e) => updateRow(index, 'base_wholesale_price', parseFloat(e.target.value) || 0)}
                                                            className="h-7 w-16 text-xs text-right"
                                                        />
                                                        <span className="text-xs text-muted-foreground">/</span>
                                                        <Input
                                                            type="number"
                                                            value={row.base_retail_price}
                                                            onChange={(e) => updateRow(index, 'base_retail_price', parseFloat(e.target.value) || 0)}
                                                            className="h-7 w-16 text-xs text-right"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.variant_sku || ''}
                                                        onChange={(e) => updateRow(index, 'variant_sku', e.target.value)}
                                                        className="h-7 font-mono text-xs"
                                                        placeholder="-"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        value={row.variant_name || ''}
                                                        onChange={(e) => updateRow(index, 'variant_name', e.target.value)}
                                                        className="h-7 text-sm"
                                                        placeholder="-"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">
                                                    {[row.option_1, row.option_2, row.option_3].filter(Boolean).join(', ') || '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-destructive"
                                                        onClick={() => removeRow(index)}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </Button>
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
                            <Button variant="outline" onClick={resetState}>
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
