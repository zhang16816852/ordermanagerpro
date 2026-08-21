import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
  children,
}: PageHeaderProps) {
  return (
    <div className={cn('page-enter', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="flex-shrink-0 text-muted-foreground">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate font-display">{title}</h1>
            {subtitle && (
              <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            {actions}
          </div>
        )}
        {children}
      </div>
      <div className="brand-bar h-[2px] mt-4 rounded-full opacity-60" />
    </div>
  );
}
