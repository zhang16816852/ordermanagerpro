import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

type FilterChipTone = 'secondary' | 'green' | 'amber' | 'destructive' | 'outline';

const TONE_VARIANT: Record<FilterChipTone, 'secondary' | 'default' | 'destructive' | 'outline'> = {
  secondary: 'secondary',
  green: 'default',
  amber: 'default',
  destructive: 'destructive',
  outline: 'outline',
};

const TONE_CLASS: Record<FilterChipTone, string> = {
  secondary: '',
  green: 'bg-green-600',
  amber: 'bg-amber-500',
  destructive: '',
  outline: 'text-muted-foreground',
};

interface FilterChipProps {
  tone?: FilterChipTone;
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}

/** 可點擊切換的統計 chip：作為匯入預覽表的狀態篩選器 */
export function FilterChip({ tone = 'secondary', active, onClick, icon, children }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        active ? 'ring-2 ring-foreground/30' : 'opacity-60 hover:opacity-100'
      }`}
    >
      <Badge variant={TONE_VARIANT[tone]} className={`text-sm ${TONE_CLASS[tone]}`}>
        {icon}
        {children}
      </Badge>
    </button>
  );
}