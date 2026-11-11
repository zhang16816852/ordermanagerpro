import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function CheckboxRow({
  id,
  checked,
  onCheckedChange,
  label,
  count,
  depth = 0,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  count?: number;
  depth?: number;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5" style={{ paddingLeft: depth * 12 }}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onCheckedChange(c === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer flex-1 truncate text-muted-foreground hover:text-foreground">
        {label}
        {count != null && <span className="ml-1 text-xs opacity-60">({count})</span>}
      </Label>
    </div>
  );
}
