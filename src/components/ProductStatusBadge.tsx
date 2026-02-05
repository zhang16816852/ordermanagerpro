import { Badge } from "@/components/ui/badge";
import { ProductStatusConfig, ProductStatusType } from "@/hooks/config/productSattus";

export function StatusBadge({ status }: { status: ProductStatusType }) {
    const config = ProductStatusConfig[status];

    return (
        <Badge className={config.badgeClass}>
            {config.label}
        </Badge>
    );
}
