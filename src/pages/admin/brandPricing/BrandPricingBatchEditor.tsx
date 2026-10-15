import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Save } from 'lucide-react';

interface BrandPricingBatchEditorProps {
  selectedCount: number;
  isPending: boolean;
  canSave: boolean;
  onApplyBatchPrice: (value: string) => void;
  onSave: () => void;
}

export const BrandPricingBatchEditor = ({
  selectedCount,
  isPending,
  canSave,
  onApplyBatchPrice,
  onSave,
}: BrandPricingBatchEditorProps) => {
  if (selectedCount === 0) return null;

  return (
    <Card className="border-primary">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">批次設定批發價</CardTitle>
        <CardDescription>已選擇 {selectedCount} 個項目</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">批發價：</span>
            <Input
              type="number"
              placeholder="批發價"
              className="w-32"
              onBlur={(e) => e.target.value && onApplyBatchPrice(e.target.value)}
            />
          </div>
          <Button onClick={onSave} disabled={isPending || !canSave}>
            <Save className="mr-2 h-4 w-4" />
            {isPending ? '儲存中…' : '儲存選定項目'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
