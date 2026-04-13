import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Package, Truck, CheckSquare, List, LayoutGrid } from 'lucide-react';

interface OrderFiltersProps {
  statusTab: 'pending' | 'processing' | 'shipped';
  onStatusTabChange: (v: 'pending' | 'processing' | 'shipped') => void;
  viewMode: 'orders' | 'items';
  onViewModeChange: (v: 'orders' | 'items') => void;
  search: string;
  onSearchChange: (v: string) => void;
  storeFilter: string;
  onStoreFilterChange: (v: string) => void;
  stores: any[];
}

export function OrderFilters({
  statusTab,
  onStatusTabChange,
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  storeFilter,
  onStoreFilterChange,
  stores,
}: OrderFiltersProps) {
  return (
    <div className="space-y-4 flex-none">
      <div className="flex items-center justify-between">
        <Tabs value={statusTab} onValueChange={(v) => onStatusTabChange(v as any)}>
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="pending" className="gap-2 px-6">
              <Package className="h-4 w-4" /> 未確認
            </TabsTrigger>
            <TabsTrigger value="processing" className="gap-2 px-6">
              <Truck className="h-4 w-4" /> 處理中
            </TabsTrigger>
            <TabsTrigger value="shipped" className="gap-2 px-6">
              <CheckSquare className="h-4 w-4" /> 已出貨
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-lg">
          <Button
            variant={viewMode === 'orders' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewModeChange('orders')}
            className="h-8"
          >
            <List className="h-4 w-4 mr-1" /> 訂單
          </Button>
          <Button
            variant={viewMode === 'items' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onViewModeChange('items')}
            className="h-8"
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> 商品
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={viewMode === 'orders' ? "搜尋訂單編號或店鋪..." : "搜尋產品名稱或 SKU..."}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-10 border-muted"
          />
        </div>
        <Select value={storeFilter} onValueChange={onStoreFilterChange}>
          <SelectTrigger className="w-56 h-10 border-muted">
            <SelectValue placeholder="選擇店鋪" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部店鋪</SelectItem>
            {stores.map((store) => (
              <SelectItem key={store.id} value={store.id}>
                {store.code ? `${store.code} - ${store.name}` : store.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
