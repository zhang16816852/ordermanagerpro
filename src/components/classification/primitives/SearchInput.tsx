import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SearchInputSize = "sm" | "md";

export function SearchInput({
  value,
  onChange,
  placeholder = "搜尋...",
  className,
  inputClassName,
  iconSize = "sm",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  iconSize?: SearchInputSize;
  disabled?: boolean;
}) {
  const iconClass = iconSize === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <div className={cn("relative", className)}>
      <Search className={cn("absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground", iconClass)} />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("h-8 text-xs pl-7", inputClassName)}
      />
    </div>
  );
}