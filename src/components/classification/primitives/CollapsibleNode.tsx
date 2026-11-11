import { ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CollapsibleNode({
  label,
  count,
  expanded,
  onToggle,
  selected,
  onSelect,
  hasChildren,
  depth = 0,
  icon,
}: {
  label: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
  selected?: boolean;
  onSelect?: () => void;
  hasChildren?: boolean;
  depth?: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 py-1" style={{ paddingLeft: depth * 12 }}>
      {hasChildren ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </Button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      {icon}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex-1 text-left text-sm transition-colors truncate",
          selected ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {count != null && <span className="ml-1 text-xs opacity-60">({count})</span>}
      </button>
    </div>
  );
}
