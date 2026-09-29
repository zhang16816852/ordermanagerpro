import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getSpecFormatInfo } from './productRowHelpers';

export function SpecFormatBadge({ specValues, hasSynced }: { specValues: any; hasSynced?: boolean }) {
    const info = getSpecFormatInfo(specValues, hasSynced);
    if (info.icon === 'empty') return null;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1 h-4 rounded border cursor-help ${info.color}`}>
                    {info.icon === 'new'
                        ? <CheckCircle2 className="h-2.5 w-2.5" />
                        : <AlertCircle className="h-2.5 w-2.5" />}
                    {info.label}
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-[200px]">
                {info.tip}
            </TooltipContent>
        </Tooltip>
    );
}
