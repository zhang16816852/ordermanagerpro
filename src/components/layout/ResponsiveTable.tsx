import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveTableProps {
  table: ReactNode;
  cards: ReactNode;
  className?: string;
  tableClassName?: string;
  cardsClassName?: string;
}

export function ResponsiveTable({
  table,
  cards,
  className,
  tableClassName,
  cardsClassName,
}: ResponsiveTableProps) {
  return (
    <>
      <div
        className={cn(
          'hidden md:block flex-1 min-h-0',
          className,
          tableClassName
        )}
      >
        <div className="h-full flex flex-col">
          {table}
        </div>
      </div>
      <div
        className={cn(
          'md:hidden flex-1 min-h-0',
          className,
          cardsClassName
        )}
      >
        {cards}
      </div>
    </>
  );
}
