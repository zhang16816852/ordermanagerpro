import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { CheckSquare, Square, Layers } from 'lucide-react';
import { DeviceModelGroup } from '@/pages/admin/products/hooks/useDeviceModelGroups';

interface VariantModelMatrixGroupsTabProps {
    variants: any[];
    filteredGroups: DeviceModelGroup[];
    localGroupLinks: Record<string, Set<string>>;
    toggleGroupLink: (vId: string, gId: string) => void;
    applyGroupRowToAll: (gId: string, checked: boolean) => void;
}

export function VariantModelMatrixGroupsTab({
    variants,
    filteredGroups,
    localGroupLinks,
    toggleGroupLink,
    applyGroupRowToAll
}: VariantModelMatrixGroupsTabProps) {
    if (filteredGroups.length === 0) {
        return (
            <div className="p-8 text-center text-sm text-muted-foreground border rounded-lg">
                找不到符合的型號群組
            </div>
        );
    }

    return (
        <div className="overflow-auto max-h-[50vh] min-h-[300px] border rounded-lg">
            <Table>
                <TableHeader className="sticky top-0 z-20 shadow-sm">
                    <TableRow className="bg-muted">
                        <TableHead className="w-[200px] font-bold bg-muted sticky left-0 top-0 z-30 border-r">群組名稱</TableHead>
                        {variants.map(v => (
                            <TableHead key={v.id} className="min-w-[120px] text-center px-4 font-medium border-r last:border-r-0 bg-muted">
                                <div className="break-words whitespace-normal text-xs" title={v.name}>{v.name}</div>
                            </TableHead>
                        ))}
                        <TableHead className="w-[80px] text-center font-bold bg-muted">全選列</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredGroups.map(group => (
                        <TableRow key={group.id} className="group hover:bg-muted/5">
                            <TableCell className="font-medium bg-background sticky left-0 z-10 border-r group-hover:bg-muted transition-colors">
                                <div className="flex items-center gap-1.5">
                                    <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <div>
                                        <div className="text-xs font-bold">{group.name}</div>
                                        {group.description && (
                                            <div className="text-[10px] text-muted-foreground opacity-60 truncate max-w-[140px]">{group.description}</div>
                                        )}
                                    </div>
                                </div>
                            </TableCell>
                            {variants.map(v => (
                                <TableCell key={v.id} className="p-2 border-r last:border-r-0">
                                    <div className="flex justify-center">
                                        <Checkbox
                                            checked={!!localGroupLinks[v.id]?.has(group.id)}
                                            onCheckedChange={() => toggleGroupLink(v.id, group.id)}
                                        />
                                    </div>
                                </TableCell>
                            ))}
                            <TableCell className="text-center bg-primary/5">
                                <div className="flex justify-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/20" onClick={() => applyGroupRowToAll(group.id, true)}>
                                        <CheckSquare className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" onClick={() => applyGroupRowToAll(group.id, false)}>
                                        <Square className="h-4 w-4" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
