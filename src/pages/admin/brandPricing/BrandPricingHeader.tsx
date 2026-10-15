import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

interface BrandPricingHeaderProps {
  onRefresh: () => void;
}

export const BrandPricingHeader = ({ onRefresh }: BrandPricingHeaderProps) => (
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-bold tracking-tight">連鎖客戶批發價設定</h1>
      <p className="text-muted-foreground">批次設定各連鎖客戶的產品與變體批發價</p>
    </div>
    <Button variant="outline" onClick={onRefresh}>
      <RefreshCw className="mr-2 h-4 w-4" />
      重新載入產品
    </Button>
  </div>
);
