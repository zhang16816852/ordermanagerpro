import type { ElementType } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function SectionHeader({
    label,
    isOpen,
    count,
    selectedCount,
    icon: Icon,
}: {
    label: string;
    isOpen: boolean;
    count?: number;
    selectedCount?: number;
    icon: ElementType;
}) {
    return (
        <CollapsibleTrigger asChild>
            <button
                className="flex items-center justify-between w-full text-xs font-bold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors group py-1"
            >
                <span className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 opacity-60" />
                    {label}
                    {selectedCount !== undefined && selectedCount > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">{selectedCount}</Badge>
                    )}
                    {count !== undefined && !isOpen && (
                        <span className="text-[10px] font-normal text-muted-foreground/60 tabular-nums">{count}</span>
                    )}
                </span>
                <ChevronDown
                    className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200 text-muted-foreground/50 group-hover:text-foreground",
                        isOpen && "rotate-180"
                    )}
                />
            </button>
        </CollapsibleTrigger>
    );
}

export function SectionSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <div className="space-y-2.5 py-1">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <Skeleton className={cn("h-3.5 rounded", i % 2 === 0 ? "w-20" : "w-16")} />
                </div>
            ))}
        </div>
    );
}

export function EmptyState({ icon: Icon, text }: { icon: ElementType; text: string }) {
    return (
        <div className="flex flex-col items-center gap-1.5 py-4 text-muted-foreground/50">
            <Icon className="h-5 w-5" />
            <p className="text-[11px] italic">{text}</p>
        </div>
    );
}