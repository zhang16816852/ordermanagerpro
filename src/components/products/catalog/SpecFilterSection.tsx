import { SlidersHorizontal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { SectionHeader } from "./sidebarPrimitives";
import { SpecFilterSectionProps } from "./catalogSidebarTypes";
import { SpecFilter } from "@/components/specs/SpecFilter";

export function SpecFilterSection({
    open,
    onOpenChange,
    availableSpecs,
    specFields,
    selectedSpecs,
    onSpecChange,
}: SpecFilterSectionProps) {
    return (
        <Collapsible open={open} onOpenChange={onOpenChange}>
            <div className="py-2">
                <SectionHeader
                    label="進階規格"
                    isOpen={open}
                    icon={SlidersHorizontal}
                />
            </div>
            <CollapsibleContent>
                <SpecFilter
                    availableSpecs={availableSpecs}
                    specFields={specFields}
                    selectedSpecs={selectedSpecs}
                    onSpecChange={onSpecChange}
                />
            </CollapsibleContent>
        </Collapsible>
    );
}
