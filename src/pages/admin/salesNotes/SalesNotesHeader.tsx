import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, FileUp, LayoutGrid, List, ReceiptText } from "lucide-react";

interface SalesNotesHeaderProps {
  viewMode: "notes" | "product";
  isRep: boolean;
  onViewModeChange: (mode: "notes" | "product") => void;
  onImport: () => void;
  onStatement: () => void;
}

export function SalesNotesHeader({
  viewMode,
  isRep,
  onViewModeChange,
  onImport,
  onStatement,
}: SalesNotesHeaderProps) {
  return (
    <CardHeader className="shrink-0 px-4 py-3 flex flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle className="flex items-center gap-2 text-base">
        {viewMode === "product" ? <LayoutGrid className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        {viewMode === "product" ? "商品銷售彙總" : "銷售單列表"}
      </CardTitle>
      <div className="flex items-center gap-2 shrink-0">
        {!isRep && (
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onImport}>
            <FileUp className="h-3.5 w-3.5 mr-1" /> 匯入
          </Button>
        )}
        {!isRep && (
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onStatement}>
            <ReceiptText className="h-3.5 w-3.5 mr-1" /> 對帳單
          </Button>
        )}
        <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-lg">
          <Button
            variant={viewMode === "notes" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onViewModeChange("notes")}
          >
            <List className="h-3.5 w-3.5 mr-1" /> 銷售單
          </Button>
          <Button
            variant={viewMode === "product" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onViewModeChange("product")}
          >
            <LayoutGrid className="h-3.5 w-3.5 mr-1" /> 商品加總
          </Button>
        </div>
      </div>
    </CardHeader>
  );
}
