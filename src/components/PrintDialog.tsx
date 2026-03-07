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
import { Printer } from "lucide-react";

interface PrintDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onPrint: (options: PrintOptions) => void;
}

export interface PrintOptions {
    paperSize: "a4" | "middle-cut";
    margin: "full" | "standard";
}

export const PrintDialog: React.FC<PrintDialogProps> = ({
    isOpen,
    onClose,
    onPrint,
}) => {
    const [options, setOptions] = useState<PrintOptions>({
        paperSize: "a4",
        margin: "full",
    });

    const handlePrint = () => {
        onPrint(options);
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Printer className="h-5 w-5" />
                        列印選項
                    </DialogTitle>
                    <DialogDescription>
                        請選擇您要列印的格式與設定。
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="paper-size" className="text-right">
                            紙張尺寸
                        </Label>
                        <Select
                            value={options.paperSize}
                            onValueChange={(value: any) =>
                                setOptions((prev) => ({ ...prev, paperSize: value }))
                            }
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="選擇尺寸" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="a4">A4 (210 x 297mm)</SelectItem>
                                <SelectItem value="middle-cut">中一刀 (9.5" x 5.5")</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="margin" className="text-right">
                            邊距設定
                        </Label>
                        <Select
                            value={options.margin}
                            onValueChange={(value: any) =>
                                setOptions((prev) => ({ ...prev, margin: value }))
                            }
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="選擇邊距" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="full">滿版 (無邊框)</SelectItem>
                                <SelectItem value="standard">標準邊距</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button onClick={handlePrint}>
                        確認列印
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
