import { useProductColors } from '@/hooks/useProductColors';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Palette } from 'lucide-react';
import { ColorManager } from '@/pages/admin/products/components/ColorManager';

interface ColorManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ColorManagementDialog({ open, onOpenChange }: ColorManagementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Palette className="h-6 w-6 text-primary" />
            顏色對照表管理
          </DialogTitle>
          <DialogDescription>
            管理顏色名稱及其對應的 SKU 代碼。SKU 代碼建議使用 2-3 碼縮寫（如黑色 ⮕ BK）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 pt-2">
          <ColorManager />
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            完成並關閉
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
