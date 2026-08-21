import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { SidebarNav } from './SidebarNav';
import type { NavItem } from '@/config/navigation';

interface MobileSidebarProps {
  navItems: NavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileSidebar({ navItems, open, onOpenChange }: MobileSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-2">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
        <SheetTitle className="sr-only">導覽選單</SheetTitle>
        <SheetDescription className="sr-only">存取系統的各個模組與功能</SheetDescription>
        <SidebarNav navItems={navItems} onNavClick={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
