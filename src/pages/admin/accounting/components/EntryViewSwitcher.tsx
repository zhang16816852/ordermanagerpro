import { Button } from '@/components/ui/button';
import { HandCoins, Truck, Wrench } from 'lucide-react';
import { EntryFormController } from './useEntryFormController';

export function EntryViewSwitcher({ ctl }: { ctl: EntryFormController }) {
  const { isList, isTransferLike, isPayout, isShipping, isRepair, view, entry, handleViewChange } = ctl;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={isList ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('list')}
        disabled={!!entry}
      >
        記錄收支
      </Button>
      <Button
        variant={view === 'transfer' ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('transfer')}
        disabled={!!entry}
      >
        帳戶互轉
      </Button>
      <Button
        variant={view === 'currency_exchange' ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('currency_exchange')}
        disabled={!!entry}
      >
        幣值換算
      </Button>
      <Button
        variant={isPayout ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('payout')}
        disabled={!!entry}
      >
        <HandCoins className="h-4 w-4 mr-1" /> 佣金發放
      </Button>
      <Button
        variant={isShipping ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('shipping')}
        disabled={!!entry}
      >
        <Truck className="h-4 w-4 mr-1" /> 運費結帳
      </Button>
      <Button
        variant={isRepair ? 'default' : 'outline'}
        size="sm"
        onClick={() => handleViewChange('repair')}
        disabled={!!entry}
      >
        <Wrench className="h-4 w-4 mr-1" /> 維修收支
      </Button>
    </div>
  );
}