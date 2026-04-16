import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Zap, Target } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SpecDefinition } from '../../types';
import { SpecRelationInfo } from '../../hooks/useSpecRelations';

interface SpecCardProps {
    spec: SpecDefinition;
    relation?: SpecRelationInfo;
    onEdit: (spec: SpecDefinition) => void;
    onDelete: (spec: SpecDefinition) => void;
    showRelations?: boolean;
}

export function SpecLibraryCard({ spec, relation, onEdit, onDelete, showRelations = true }: SpecCardProps) {
    return (
        <Card className="relative group overflow-hidden border-primary/10 hover:border-primary/40 hover:shadow-md transition-all duration-200">
            <CardHeader className="pb-2 space-y-1">
                <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-sm font-bold truncate leading-tight grow" title={spec.name}>
                        {spec.name}
                    </CardTitle>
                    <Badge variant="outline" className="text-[9px] px-1.5 h-4 shrink-0 font-mono uppercase bg-muted/50">
                        {spec.type}
                    </Badge>
                </div>
                
                {/* 關係標籤列 */}
                {showRelations && (
                    <div className="flex flex-wrap gap-1 mt-1 empty:hidden">
                        {relation?.isSource && (
                            <Badge className="bg-orange-500/10 text-orange-600 border-orange-200 text-[9px] hover:bg-orange-500/20 px-1">
                                <Zap className="h-2 w-2 mr-1 fill-current" /> 連動源
                            </Badge>
                        )}
                        {relation?.isTarget && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Badge className="bg-blue-500/10 text-blue-600 border-blue-200 text-[9px] hover:bg-blue-500/20 px-1">
                                            <Target className="h-2 w-2 mr-1" /> 連動目標
                                        </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">
                                        受此規格控制: {relation.parentNames.join(', ')}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                )}

                <CardDescription className="text-[11px] line-clamp-2 min-h-[32px] pt-1 leading-normal">
                    {spec.type === 'text' ? '自由文字輸入' :
                        spec.type === 'boolean' ? '支援/不支援 (開關)' :
                            spec.type === 'number_with_unit' ? `數值輸入 (單位: ${spec.options?.[0] || '無'})` :
                                spec.options?.join(' / ')}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-1.5 py-2 px-3 bg-muted/20 border-t mt-auto">
                <Button
                    variant="ghost" size="icon" className="h-7 w-7 hover:bg-background shadow-sm"
                    onClick={() => onEdit(spec)}
                >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
                <Button
                    variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    onClick={() => onDelete(spec)}
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </Button>
            </CardContent>
        </Card>
    );
}
