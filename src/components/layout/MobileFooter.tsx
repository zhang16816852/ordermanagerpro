import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface MobileFooterProps {
  children: ReactNode;
  className?: string;
  visible?: boolean;
}

export function MobileFooter({ children, className, visible = true }: MobileFooterProps) {
  if (!visible) return null;

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-30 md:hidden',
        'bg-background/95 backdrop-blur-md border-t border-white/8',
        'p-4 safe-area-pb',
        className
      )}
    >
      {children}
    </div>
  );
}
