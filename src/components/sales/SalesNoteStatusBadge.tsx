import { Badge } from "@/components/ui/badge";

interface SalesNoteStatusBadgeProps {
    status: string;
}

const statusConfig: Record<string, { label: string; className: string; variant?: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "草稿", className: "bg-muted text-muted-foreground", variant: "secondary" },
    shipped: { label: "已出貨", className: "bg-blue-500 text-white", variant: "default" }, // Using explicit colors to match original design
    received: { label: "已收貨", className: "bg-green-500 text-white", variant: "default" },
};

export function SalesNoteStatusBadge({ status }: SalesNoteStatusBadgeProps) {
    const config = statusConfig[status] || { label: status, className: "", variant: "outline" };

    return (
        <Badge
            variant={config.variant}
            className={config.className}
        >
            {config.label}
        </Badge>
    );
}
