import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight, Home, Monitor, Smartphone, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationDropdown } from './NotificationDropdown';
import { useLayoutPreference, LAYOUT_LABELS } from '@/store/useLayoutPreference';
import type { PageHeaderConfig } from './PageHeaderContext';

interface DesktopHeaderProps {
  isExpanded: boolean;
  onToggleCollapse: () => void;
  pageHeader?: PageHeaderConfig | null;
}

export function DesktopHeader({ isExpanded, onToggleCollapse, pageHeader }: DesktopHeaderProps) {
  const navigate = useNavigate();
  const preference = useLayoutPreference((s) => s.preference);
  const cycle = useLayoutPreference((s) => s.cycle);
  const LayoutIcon = preference === 'mobile' ? Smartphone : preference === 'desktop' ? Monitor : Wand2;

  const handleBack = () => {
    if (pageHeader?.onBack) {
      pageHeader.onBack();
    } else if (pageHeader?.back) {
      navigate(pageHeader.back);
    }
  };

  const hasBack = !!(pageHeader?.back || pageHeader?.onBack);
  // mobileOnly：標題僅供手機 sticky header 使用，桌機維持頁面內的大標，避免重複
  const showTitle = !pageHeader?.mobileOnly && !!pageHeader?.title;
  const showActions = !pageHeader?.mobileOnly && !!pageHeader?.actions;

  return (
    <header
      className={cn(
        'hidden md:flex fixed top-0 right-0 h-14 items-center justify-between px-6 bg-background/60 backdrop-blur-md border-b z-30 transition-[left] duration-200',
        isExpanded ? 'left-64' : 'left-16'
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Button variant="ghost" size="icon" onClick={onToggleCollapse} className="h-8 w-8 shrink-0">
          {isExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        {hasBack && (
          <Button variant="ghost" size="icon" onClick={handleBack} aria-label="返回" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        {showTitle && (
          typeof pageHeader?.title === 'string' ? (
            <span className="text-sm font-semibold tracking-tight truncate min-w-0">{pageHeader.title}</span>
          ) : (
            pageHeader?.title
          )
        )}
      </div>
      <div className="flex items-center gap-4">
        {showActions && pageHeader?.actions}
        <Button
          variant="ghost"
          size="icon"
          onClick={cycle}
          aria-label={`版面：${LAYOUT_LABELS[preference]}（點擊切換）`}
          title={LAYOUT_LABELS[preference]}
          className="h-8 w-8 shrink-0"
        >
          <LayoutIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="返回首頁" className="h-8 w-8 shrink-0">
          <Home className="h-4 w-4" />
        </Button>
        <NotificationDropdown />
      </div>
    </header>
  );
}