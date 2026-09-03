import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer } from "lucide-react";

interface PrintDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onPrint: (options: PrintOptions) => void;
}

export type PrintOutput = "pdf" | "excel";

export interface PrintOptions {
    output: PrintOutput;
    paperSize: "a4" | "middle-cut";
    margin: "full" | "standard";
    showPrice: boolean;
    showQR: boolean;
}

const OUTPUT_LABEL: Record<PrintOutput, string> = {
    pdf: "PDF",
    excel: "Excel",
};

const CONFIRM_LABEL: Record<PrintOutput, string> = {
    pdf: "匯出 PDF",
    excel: "匯出 Excel",
};

export const PrintDialog: React.FC<PrintDialogProps> = ({
    isOpen,
    onClose,
    onPrint,
}) => {
    const [options, setOptions] = useState<PrintOptions>({
        output: "pdf",
        paperSize: "a4",
        margin: "standard",
        showPrice: true,
        showQR: true,
    });

    const update = <K extends keyof PrintOptions>(key: K, value: PrintOptions[K]) => {
        setOptions((prev) => ({ ...prev, [key]: value }));
    };

    const handleConfirm = () => {
        onPrint(options);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="h-5 w-5" />
                        匯出選項
                    </DialogTitle>
                    <DialogDescription>
                        請選擇您要匯出的格式與設定。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="output-type" className="text-right">
                            輸出格式
                        </Label>
                        <Select
                            value={options.output}
                            onValueChange={(value: any) => update("output", value)}
                        >
                            <SelectTrigger id="output-type" className="col-span-3">
                                <SelectValue placeholder="選擇格式" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="pdf">{OUTPUT_LABEL.pdf}</SelectItem>
                                <SelectItem value="excel">{OUTPUT_LABEL.excel}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="paper-size" className="text-right">
                            紙張尺寸
                        </Label>
                        <Select
                            value={options.paperSize}
                            onValueChange={(value: any) => update("paperSize", value)}
                        >
                            <SelectTrigger id="paper-size" className="col-span-3">
                                <SelectValue placeholder="選擇尺寸" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="a4">A4 (210 x 297mm)</SelectItem>
                                <SelectItem value="middle-cut">中一刀 (241 x 140mm)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">顯示價格</Label>
                        <div className="col-span-3 flex items-center gap-2">
                            <Checkbox
                                id="show-price"
                                checked={options.showPrice}
                                onCheckedChange={(checked) => update("showPrice", checked === true)}
                            />
                            <label htmlFor="show-price" className="text-sm">
                                單價 / 小計 / 總金額
                            </label>
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label className="text-right">顯示 QR Code</Label>
                        <div className="col-span-3 flex items-center gap-2">
                            <Checkbox
                                id="show-qr"
                                checked={options.showQR}
                                onCheckedChange={(checked) => update("showQR", checked === true)}
                            />
                            <label htmlFor="show-qr" className="text-sm">
                                頁首右上角 QR Code
                            </label>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button onClick={handleConfirm}>
                        {CONFIRM_LABEL[options.output]}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
