import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationDropdown } from './NotificationDropdown';

interface DesktopHeaderProps {
  isExpanded: boolean;
  onToggleCollapse: () => void;
}

export function DesktopHeader({ isExpanded, onToggleCollapse }: DesktopHeaderProps) {
  return (
    <header
      className={cn(
        'hidden md:flex fixed top-0 right-0 h-14 items-center justify-between px-6 bg-background/60 backdrop-blur-md border-b z-30 transition-[left] duration-200',
        isExpanded ? 'left-64' : 'left-16'
      )}
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-8 w-8 shrink-0">
          {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <NotificationDropdown />
      </div>
    </header>
  );
}
