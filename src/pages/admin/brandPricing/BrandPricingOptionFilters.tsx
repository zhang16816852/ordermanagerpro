import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import type { OptionFacet } from './brandPricingUtils';

interface BrandPricingOptionFiltersProps {
  optionFacets: OptionFacet[];
  selectedOptions: Record<string, string[]>;
  hasOptionFilter: boolean;
  onToggleOptionValue: (groupName: string, value: string) => void;
  onClear: () => void;
}

export const BrandPricingOptionFilters = ({
  optionFacets,
  selectedOptions,
  hasOptionFilter,
  onToggleOptionValue,
  onClear,
}: BrandPricingOptionFiltersProps) => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4" />
        選項篩選
      </div>
      {hasOptionFilter && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClear}>
          清除
        </Button>
      )}
    </div>
    {optionFacets.length === 0 ? (
      <p className="text-sm text-muted-foreground">目前沒有可用的選項</p>
    ) : (
      optionFacets.map((group) => (
        <Collapsible key={group.name} defaultOpen>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md py-1 text-sm font-medium hover:text-foreground"
            >
              <span>{group.name}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <div className="space-y-1">
              {group.values.map((v) => (
                <label
                  key={v.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/50"
                >
                  <Checkbox
                    checked={(selectedOptions[group.name] ?? []).includes(v.value)}
                    onCheckedChange={() => onToggleOptionValue(group.name, v.value)}
                  />
                  <span className="min-w-0 flex-1 truncate">{v.value}</span>
                  <span className="text-xs text-muted-foreground">{v.count}</span>
                </label>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))
    )}
  </div>
);

interface BrandPricingMobileFiltersProps extends BrandPricingOptionFiltersProps {
  open: boolean;
  activeFilterCount: number;
  onOpen: () => void;
  onClose: () => void;
}

export const BrandPricingMobileFilters = ({
  open,
  activeFilterCount,
  onOpen,
  onClose,
  ...filterProps
}: BrandPricingMobileFiltersProps) => (
  <>
    {open && (
      <div className="fixed inset-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-background shadow-xl">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="font-semibold">選項篩選</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="關閉選項篩選">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <BrandPricingOptionFilters {...filterProps} />
          </div>
        </div>
      </div>
    )}

    <Button
      className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg lg:hidden"
      onClick={onOpen}
      aria-label="選項篩選"
    >
      <SlidersHorizontal className="h-5 w-5" />
      {activeFilterCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1 text-xs text-destructive-foreground">
          {activeFilterCount}
        </span>
      )}
    </Button>
  </>
);
