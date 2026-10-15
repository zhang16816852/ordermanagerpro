import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, SlidersHorizontal } from 'lucide-react';

interface BrandPricingSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  productCount: number;
  activeFilterCount: number;
  onToggleFilters: () => void;
}

export const BrandPricingSearchBar = ({
  search,
  onSearchChange,
  productCount,
  activeFilterCount,
  onToggleFilters,
}: BrandPricingSearchBarProps) => (
  <div className="flex items-center gap-4">
    <div className="relative flex-1 max-w-sm">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="搜尋產品／變體名稱或 SKU（可用空格分隔多個關鍵字）..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="pl-9"
      />
    </div>
    <span className="text-sm text-muted-foreground">共 {productCount} 個產品</span>
    <Button
      variant="outline"
      size="sm"
      className="ml-auto hidden lg:inline-flex"
      onClick={onToggleFilters}
    >
      <SlidersHorizontal className="mr-2 h-4 w-4" />
      選項篩選
      {activeFilterCount > 0 && (
        <Badge variant="secondary" className="ml-2">
          {activeFilterCount}
        </Badge>
      )}
    </Button>
  </div>
);
