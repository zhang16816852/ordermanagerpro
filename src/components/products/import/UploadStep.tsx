import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Download, Info, FileSpreadsheet } from 'lucide-react';

interface UploadStepProps {
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onDownloadTemplate: () => void;
    onCancel: () => void;
}

export function UploadStep({ onFileUpload, onDownloadTemplate, onCancel }: UploadStepProps) {
    return (
        <div className="space-y-6 py-4">
            <div className="border-2 border-dashed rounded-xl p-12 text-center bg-muted/20 hover:bg-muted/30 transition-colors border-muted-foreground/20">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                <p className="text-lg font-bold mb-2">上傳 Excel 或 CSV 檔案</p>
                <p className="text-sm text-muted-foreground mb-6">
                    支援 .xlsx 與 .csv 格式。依照分類分頁編輯規格更直觀。
                </p>
                <Label htmlFor="unified-csv-upload" className="cursor-pointer">
                    <Input
                        id="unified-csv-upload"
                        type="file"
                        accept=".csv,.xlsx"
                        className="hidden"
                        onChange={onFileUpload}
                    />
                    <Button variant="default" asChild className="px-8 shadow-lg">
                        <span>選擇檔案並開始解析</span>
                    </Button>
                </Label>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-primary/5 rounded-xl p-5 border border-primary/20 space-y-3">
                    <h4 className="font-bold flex items-center gap-2 text-primary">
                        <Download className="h-4 w-4" />
                        下載標準範本
                    </h4>
                    <p className="text-xs text-muted-foreground">
                        建議先下載範本檔案，確保欄位格式與系統相容。範本包含純產品與變體兩種範例。
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onDownloadTemplate}
                        className="w-full bg-background"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        下載產品匯入範本.xlsx
                    </Button>
                </div>

                <Alert className="bg-amber-50/50 border-amber-200">
                    <Info className="h-4 w-4 text-amber-600" />
                    <AlertDescription className="text-xs space-y-2">
                        <strong className="text-amber-800">匯入模式說明：</strong>
                        <ul className="list-disc list-inside space-y-1 text-amber-700">
                            <li><strong>純產品</strong>：只填寫 product_* 欄位</li>
                            <li><strong>產品+變體</strong>：同時填寫 product_* 和 variant_*</li>
                            <li>同產品的多個變體，product_* 欄位應重複</li>
                        </ul>
                    </AlertDescription>
                </Alert>
            </div>

            <div className="bg-muted/50 rounded-xl p-5 space-y-4">
                <h4 className="font-bold text-sm">Excel 工作表規範</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-muted-foreground">
                    <div>
                        <p className="font-medium text-foreground mb-1">分頁與規格 (Sheets & Specs)</p>
                        <p>系統會根據工作表名稱自動識別分類。每個分類分頁會包含該分類專屬的規格欄位。</p>
                        <code className="block p-2 bg-background rounded border mt-2">規格名稱 [ID]</code>
                    </div>
                    <div>
                        <p className="font-medium text-foreground mb-1">提示</p>
                        <p>建議先「匯出產品」取得目前所有資料的 Excel，再以此檔案進行修改後匯入，這是最快速更新資料的方法。</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
