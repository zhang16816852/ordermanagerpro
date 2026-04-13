import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet } from 'lucide-react';

import { useProductImport } from './hooks/useProductImport';
import { UploadStep } from './components/UploadStep';
import { PreviewTable } from './components/PreviewTable';
import { ValidationSummary } from './components/ValidationSummary';

interface UnifiedProductImportProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function UnifiedProductImport({ open, onOpenChange }: UnifiedProductImportProps) {
    const {
        step,
        importData,
        isLoading,
        handleFileUpload,
        updateRow,
        removeRow,
        importMutation,
        downloadTemplate,
        resetState
    } = useProductImport(() => onOpenChange(false));

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
                                data={importData}
                                onUpdate={updateRow}
                                onRemove={removeRow}
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

                    <div className="flex gap-2">
                        {step === 'preview' && (
                            <Button
                                onClick={() => importMutation.mutate()}
                                disabled={isLoading || validRows.length === 0}
                                className="px-8 shadow-lg shadow-primary/20"
                            >
                                {isLoading ? '寫入資料庫中...' : `確認匯入 ${validRows.length} 筆資料`}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
