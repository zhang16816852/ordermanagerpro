import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PatternLockView } from './PatternLockView';

export type DeviceLockType = 'none' | 'numeric' | 'pattern';

export interface LockInputProps {
  lockType: DeviceLockType;
  onLockTypeChange: (type: DeviceLockType) => void;
  passcode: string;
  onPasscodeChange: (code: string) => void;
  pattern: string;
  onPatternChange: (pattern: string) => void;
}

export function LockInput({ lockType, onLockTypeChange, passcode, onPasscodeChange, pattern, onPatternChange }: LockInputProps) {
  const sequence = useMemo(() => pattern.split('').filter(ch => ch !== '' && ch !== ',').map(Number), [pattern]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>解鎖方式</Label>
        <Select value={lockType} onValueChange={(v) => onLockTypeChange(v as DeviceLockType)}>
          <SelectTrigger>
            <SelectValue placeholder="選擇解鎖方式..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">無密碼</SelectItem>
            <SelectItem value="numeric">密碼鎖</SelectItem>
            <SelectItem value="pattern">圖形鎖</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {lockType === 'numeric' && (
        <div className="space-y-2">
          <Label>密碼鎖</Label>
          <Input
            type="text"
            value={passcode}
            onChange={(e) => onPasscodeChange(e.target.value)}
            placeholder="例: 1234 或 abc@#123"
            maxLength={20}
          />
          <p className="text-xs text-muted-foreground">螢幕鎖密碼（可含英文、數字或符號）</p>
        </div>
      )}

      {lockType === 'pattern' && (
        <div className="space-y-3">
          <Label>圖形鎖路徑</Label>
          <PatternLockView pattern={pattern} onPatternChange={onPatternChange} interactive className="mx-auto" />
          <div className="flex items-center gap-2">
            <Input readOnly value={sequence.join('-')} placeholder="點選圖形鎖上的圓點，依順序設定" className="font-mono flex-1" />
            <Button variant="outline" size="icon" onClick={() => onPatternChange('')} aria-label="清除圖形鎖">
              <Eraser className="h-4 w-4" />
            </Button>
          </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            依照手機鍵盤 1-2-3 / 4-5-6 / 7-8-9 排列，點選順序即為解鎖路徑
          </p>
        </div>
      )}
    </div>
  );
}
