import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface AuditFiltersProps {
  search: string;
  setSearch: (value: string) => void;
  entityFilter: string;
  setEntityFilter: (value: string) => void;
}

export function AuditFilters({ search, setSearch, entityFilter, setEntityFilter }: AuditFiltersProps) {
  return (
    <div className="flex gap-4 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>
      <Select value={entityFilter} onValueChange={setEntityFilter}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="篩選類型" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">所有類型</SelectItem>
          <SelectItem value="order">訂單</SelectItem>
          <SelectItem value="order_item">訂單項目</SelectItem>
          <SelectItem value="sales_note">銷售單</SelectItem>
          <SelectItem value="store_user">店鋪成員</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
