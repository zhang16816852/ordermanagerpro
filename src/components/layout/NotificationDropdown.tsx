import { useNavigate } from 'react-router-dom';
import { 
    Bell, 
    Check, 
    Info, 
    Package, 
    Truck, 
    AlertTriangle,
    ExternalLink,
    ClipboardList
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotifications, NotificationItem } from '@/hooks/useNotifications';
import { formatDistanceToNow } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function NotificationDropdown() {
    const navigate = useNavigate();
    const { notifications, unreadCount, isLoading, markAsRead } = useNotifications();

    const handleNotificationClick = (notification: NotificationItem) => {
        if (!notification.read) {
            markAsRead(notification.id);
        }
        if (notification.link) {
            navigate(notification.link);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-full hover:bg-muted">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground animate-in zoom-in">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0 shadow-2xl border-muted-foreground/10 bg-card/95 backdrop-blur-md">
                <div className="flex items-center justify-between px-4 py-3 border-b">
                    <DropdownMenuLabel className="p-0 font-bold text-base">系統通知</DropdownMenuLabel>
                    {unreadCount > 0 && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {unreadCount} 則未讀
                        </Badge>
                    )}
                </div>
                
                <ScrollArea className="h-80">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                            <Bell className="h-8 w-8 mb-2 opacity-20" />
                            <p className="text-sm">尚無通知</p>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {notifications.map((n) => (
                                <div
                                    key={n.id}
                                    onClick={() => handleNotificationClick(n)}
                                    className={cn(
                                        "px-4 py-3 cursor-pointer transition-colors border-b last:border-0 hover:bg-muted/50 relative group",
                                        !n.read && "bg-primary/5 hover:bg-primary/10"
                                    )}
                                >
                                    {!n.read && (
                                        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-full" />
                                    )}
                                    <div className="flex gap-3">
                                        <div className={cn(
                                            "mt-1 h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                                            getNotificationColor(n.title)
                                        )}>
                                            {getNotificationIcon(n.title)}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <div className="flex items-center justify-between gap-1">
                                                <p className={cn("text-sm font-semibold leading-tight", !n.read && "text-primary")}>
                                                    {n.title}
                                                </p>
                                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: zhTW })}
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                                                {n.message}
                                            </p>
                                            {n.link && (
                                                <div className="flex items-center gap-1.5 pt-1 text-[10px] text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                                    詳細資料 <ExternalLink className="h-3 w-3" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
                
                <DropdownMenuSeparator className="m-0" />
                <div className="p-2">
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="w-full text-xs font-medium h-8"
                        onClick={() => navigate('/notifications')}
                    >
                        查看所有通知
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function getNotificationIcon(title: string) {
    if (title.includes('確認') || title.includes('訂單')) return <ClipboardList className="h-4 w-4" />;
    if (title.includes('出貨')) return <Truck className="h-4 w-4" />;
    if (title.includes('缺貨')) return <AlertTriangle className="h-4 w-4" />;
    return <Info className="h-4 w-4" />;
}

function getNotificationColor(title: string) {
    if (title.includes('確認')) return 'bg-emerald-100 text-emerald-600';
    if (title.includes('出貨')) return 'bg-blue-100 text-blue-600';
    if (title.includes('缺貨')) return 'bg-rose-100 text-rose-600';
    return 'bg-slate-100 text-slate-600';
}
