import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    description?: string;
    trend?: {
        value: number;
        label: string;
        isPositive: boolean;
    };
    colorClass?: string;
    isLoading?: boolean;
    className?: string;
}

export function StatCard({
    title,
    value,
    icon: Icon,
    description,
    trend,
    colorClass = "text-primary",
    isLoading,
    className
}: StatCardProps) {
    return (
        <Card className={cn("shadow-soft overflow-hidden border-none bg-card/60 backdrop-blur-sm", className)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground/80">
                    {title}
                </CardTitle>
                <div className={cn("p-2 rounded-lg bg-background/50 shadow-inner")}>
                    <Icon className={cn("h-4 w-4", colorClass)} />
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-24" />
                        <Skeleton className="h-4 w-16" />
                    </div>
                ) : (
                    <>
                        <div className="text-3xl font-bold tracking-tight">{value}</div>
                        {(description || trend) && (
                            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 font-medium">
                                {trend && (
                                    <span className={cn(
                                        "px-1 rounded",
                                        trend.isPositive ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
                                    )}>
                                        {trend.isPositive ? '+' : ''}{trend.value}%
                                    </span>
                                )}
                                <span className="opacity-70">{description || trend?.label}</span>
                            </p>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
