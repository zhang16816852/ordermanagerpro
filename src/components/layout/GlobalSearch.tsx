import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { 
    Search, 
    Store, 
    Package, 
    ClipboardList, 
    Command as CommandIcon,
    Loader2
} from 'lucide-react';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function GlobalSearch() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const navigate = useNavigate();
    const { results, isLoading } = useGlobalSearch(query);

    // 監聽熱鍵 Ctrl+K / Cmd+K
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen((open) => !open);
            }
        };

        document.addEventListener('keydown', down);
        return () => document.removeEventListener('keydown', down);
    }, []);

    const onSelect = (href: string) => {
        setOpen(false);
        setQuery('');
        navigate(href);
    };

    return (
        <>
            {/* 觸發按鈕佔位符 (可由 AppLayout 渲染) */}
            <button
                onClick={() => setOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 hover:bg-muted rounded-full transition-colors border max-w-[200px] w-full"
            >
                <Search className="h-4 w-4" />
                <span>全站搜尋...</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100">
                    <span className="text-xs">⌘</span>K
                </kbd>
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="p-0 border-none shadow-2xl max-w-2xl bg-transparent top-[20%] translate-y-0">
                    <DialogHeader className="sr-only">
                        <DialogTitle>全站搜尋</DialogTitle>
                        <DialogDescription>
                            輸入關鍵字以搜尋店鋪、產品 SKU 或訂單編號。支援快捷鍵組合呼叫（⌘K）。
                        </DialogDescription>
                    </DialogHeader>
                    <Command className="rounded-xl border bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center border-b px-4 py-3 gap-3">
                            <Search className="h-5 w-5 text-muted-foreground" />
                            <Command.Input
                                value={query}
                                onValueChange={setQuery}
                                placeholder="搜尋店鋪、產品 SKU 或訂單編號..."
                                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground"
                            />
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>

                        <Command.List className="max-h-[300px] overflow-y-auto p-2">
                            <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                                {query.length < 2 ? '請輸入至少 2 個字以開始搜尋...' : '找不到相符的結果。'}
                            </Command.Empty>

                            {/* 店鋪 */}
                            <Command.Group heading={<span className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">店鋪管理</span>}>
                                {results.filter(r => r.type === 'store').map(result => (
                                    <CommandItem key={result.id} result={result} onSelect={onSelect} icon={Store} />
                                ))}
                            </Command.Group>

                            {/* 產品 */}
                            <Command.Group heading={<span className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-2 block">商品目錄</span>}>
                                {results.filter(r => r.type === 'product').map(result => (
                                    <CommandItem key={result.id} result={result} onSelect={onSelect} icon={Package} />
                                ))}
                            </Command.Group>

                            {/* 訂單 */}
                            <Command.Group heading={<span className="px-2 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-2 block">訂單與銷售</span>}>
                                {results.filter(r => r.type === 'order').map(result => (
                                    <CommandItem key={result.id} result={result} onSelect={onSelect} icon={ClipboardList} />
                                ))}
                            </Command.Group>
                        </Command.List>

                        <div className="border-t px-4 py-2 bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
                            <div className="flex gap-3">
                                <span className="flex items-center gap-1"><kbd className="bg-background px-1 rounded border">↑↓</kbd> 選擇</span>
                                <span className="flex items-center gap-1"><kbd className="bg-background px-1 rounded border">Enter</kbd> 查看</span>
                            </div>
                            <span>Esc 關閉</span>
                        </div>
                    </Command>
                </DialogContent>
            </Dialog>
        </>
    );
}

function CommandItem({ 
    result, 
    onSelect, 
    icon: Icon 
}: { 
    result: any; 
    onSelect: (h: string) => void;
    icon: any;
}) {
    return (
        <Command.Item
            onSelect={() => onSelect(result.href)}
            className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-primary/10 aria-selected:bg-primary/10 transition-colors group"
        >
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/20 group-aria-selected:bg-primary/20">
                <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary group-aria-selected:text-primary" />
            </div>
            <div className="flex flex-col">
                <span className="text-sm font-medium">{result.title}</span>
                {result.subtitle && <span className="text-[10px] text-muted-foreground">{result.subtitle}</span>}
            </div>
        </Command.Item>
    );
}
