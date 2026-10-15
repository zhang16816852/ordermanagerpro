import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StorePicker } from '@/components/ui/StorePicker';
import { Tags } from 'lucide-react';
import type { BrandStoreOption } from './useBrandPricingQueries';

interface BrandPricingStoreCardProps {
  stores: BrandStoreOption[];
  selectedStore: string;
  onStoreChange: (value: string) => void;
}

export const BrandPricingStoreCard = ({
  stores,
  selectedStore,
  onStoreChange,
}: BrandPricingStoreCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Tags className="h-5 w-5" />
        選擇連鎖客戶
      </CardTitle>
      <CardDescription>選擇要設定批發價的連鎖客戶</CardDescription>
    </CardHeader>
    <CardContent>
      <StorePicker
        stores={stores}
        value={selectedStore}
        onChange={(v) => onStoreChange(v as string)}
        valueField="brand"
        placeholder="選擇連鎖客戶..."
        searchPlaceholder="搜尋連鎖客戶..."
      />
      {selectedStore && (
        <Badge variant="secondary" className="mt-3 text-base px-3 py-1">
          目前連鎖客戶：{selectedStore}
        </Badge>
      )}
    </CardContent>
  </Card>
);
