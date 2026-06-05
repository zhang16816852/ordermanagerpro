import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet } from 'lucide-react';

import { useProductImport } from './useProductImport';
import { UploadStep } from './UploadStep';
import { PreviewTable } from './PreviewTable';
import { ValidationSummary } from './ValidationSummary';

interface UnifiedProductImportProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function UnifiedProductImport({ open, onOpenChange, onSuccess }: UnifiedProductImportProps) {
    const {
        step,
        importData,
        filteredData,
        filterCategory,
        setFilterCategory,
        filterStatus,
        setFilterStatus,
        categories,
        isLoading,
        handleFileUpload,
        updateRow,
        removeRow,
        importMutation,
        downloadTemplate,
        resetState,
        allBrands,
        specDefs,
        uploadProgress,
        processedCount,
        skippedCount
    } = useProductImport(() => {
        onSuccess?.();
        onOpenChange(false);
    });

    const handleClose = () => {
        resetState();
        onOpenChange(false);
    };

    const validRows = importData.filter(r => r.isValid);

    return (
        <Dialog open={open} onOpenChange={(v) => v ? onOpenChange(v) : handleClose()}>
            <DialogContent className="max-w-[1240px] w-[95vw] max-h-[95vh] overflow-hidden flex flex-col p-0 border-none shadow-2xl">
                <DialogHeader className="p-6 bg-muted/30 border-b">
                    <DialogTitle className="flex items-center gap-3 text-xl font-bold">
                        <div className="bg-primary/10 p-2 rounded-lg">
                            <FileSpreadsheet className="h-6 w-6 text-primary" />
                        </div>
                        批次匯入產品與變體
                        {step === 'preview' && (
                            <Badge variant="outline" className="ml-2 bg-background border-primary/20 text-primary">
                                步驟 2: 預覽與確認
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        請上傳符合格式的 Excel 或 CSV 檔案以進行批次產品匯入。您可以在此步驟預覽資料並修正錯誤。
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto p-6 bg-background">
                    {step === 'upload' ? (
                        <UploadStep
                            onFileUpload={handleFileUpload}
                            onDownloadTemplate={downloadTemplate}
                            onCancel={handleClose}
                        />
                    ) : (
                        <div className="space-y-6">
                            <ValidationSummary data={importData} />
                            <PreviewTable
                                data={filteredData}
                                categories={categories}
                                filterCategory={filterCategory}
                                onFilterChange={setFilterCategory}
                                filterStatus={filterStatus}
                                onStatusFilterChange={setFilterStatus}
                                onUpdate={updateRow}
                                onRemove={removeRow}
                                allBrands={allBrands}
                                specDefs={specDefs}
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="p-6 bg-muted/30 border-t flex justify-between items-center sm:justify-between">
                    {step === 'upload' ? (
                        <Button variant="ghost" onClick={handleClose}>
                            取消
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={resetState} disabled={isLoading}>
                            重新上傳檔案
                        </Button>
                    )}

                    {isLoading && (
                        <div className="flex-1 max-w-md mx-6 flex flex-col justify-center">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                <span>分批寫入資料庫中... ({processedCount}/{validRows.length})</span>
                                <span className="font-semibold">{uploadProgress}%</span>
                            </div>
                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden border">
                                <div
                                    className="bg-primary h-full transition-all duration-300 rounded-full"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2">
                        {step === 'preview' && (
                            <Button
                                onClick={() => importMutation.mutate()}
                                disabled={isLoading || validRows.length === 0}
                                className="px-8 shadow-lg shadow-primary/20"
                            >
                                {isLoading ? '寫入中...' : `確認匯入 ${validRows.length} 筆資料`}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
