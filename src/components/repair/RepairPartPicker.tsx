import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RepairPartPickerDialog, RepairPartSelection } from '@/components/repair/RepairPartPickerDialog';

export type { RepairPartSelection };

interface RepairPartPickerProps {
  value: RepairPartSelection | null;
  onSelect: (selection: RepairPartSelection | null) => void;
  deviceModelId?: string | null;
  disabled?: boolean;
  onCreatePart?: () => void;
  onEditPart?: (repairPartId: string) => void;
  placeholder?: string;
}

export function RepairPartPicker({
  value,
  onSelect,
  deviceModelId,
  disabled = false,
  onCreatePart,
  onEditPart,
}: RepairPartPickerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const currentName = value?.part_name?.trim() || '';
  const isFromCatalog = !!value?.repair_part_id;

  return (
    <div className="flex items-center gap-1.5 w-full min-w-0">
      <Input
        value={currentName}
        onChange={(e) => {
          const nextName = e.target.value;
          // 手動改名視為自訂材料：清除型錄與庫存綁定
          onSelect({
            repair_part_id: null,
            product_id: null,
            variant_id: null,
            part_name: nextName,
            unit_cost: value?.unit_cost || 0,
          });
        }}
        placeholder={isFromCatalog ? '零件名稱' : '零件名稱（可直接輸入自訂材料）'}
        title={currentName || '零件名稱'}
        disabled={disabled}
        className="h-9 text-sm font-medium flex-1 min-w-0"
      />

      {isFromCatalog && onEditPart && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-9 px-2 text-xs shrink-0"
          onClick={() => onEditPart(value!.repair_part_id!)}
          title="編輯零件型錄"
        >
          編輯
        </Button>
      )}

      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        onClick={() => setDialogOpen(true)}
        title={currentName ? '點擊更換零件' : '點擊放大鏡選擇零件'}
        aria-label="開啟零件型錄"
      >
        <Search className="h-4 w-4" />
      </Button>

      <RepairPartPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentValue={{ repair_part_id: value?.repair_part_id || null }}
        deviceModelId={deviceModelId}
        onCreatePart={onCreatePart}
        onSelect={(sel) => onSelect(sel)}
      />
    </div>
  );
}
