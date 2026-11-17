import { Badge } from "@/components/ui/badge";
import { ProductStatusConfig, ProductStatusType } from "@/hooks/config/productSattus";

export function StatusBadge({ status }: { status?: ProductStatusType | string | null }) {
    const config = status ? ProductStatusConfig[status as ProductStatusType] : undefined;
    if (!config) return null;
    return (
        <Badge className={config.badgeClass}>
            {config.label}
        </Badge>
    );
}
