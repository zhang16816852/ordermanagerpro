import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

interface ShippingPoolFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  storeFilter: string;
  onStoreFilterChange: (value: string) => void;
  stores: Array<{ id: string; name: string }> | undefined;
}

export function ShippingPoolFilterBar({
  search,
  onSearchChange,
  storeFilter,
  onStoreFilterChange,
  stores,
}: ShippingPoolFilterBarProps) {
  return (
    <div className="flex gap-4 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋店鋪或產品..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      <Select value={storeFilter} onValueChange={onStoreFilterChange}>
        <SelectTrigger className="w-48">
          <SelectValue placeholder="篩選店鋪" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">所有店鋪</SelectItem>
          {stores?.map((store) => (
            <SelectItem key={store.id} value={store.id}>
              {store.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}