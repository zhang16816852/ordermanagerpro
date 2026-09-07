import { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

const parseSequence = (pattern: string): number[] =>
  pattern.split('').map(Number).filter((n) => n >= 1 && n <= 9);

interface PatternLockViewProps {
  pattern: string;
  size?: number;
  interactive?: boolean;
  onPatternChange?: (pattern: string) => void;
  className?: string;
}

export function PatternLockView({
  pattern,
  size = 180,
  interactive = false,
  onPatternChange,
  className,
}: PatternLockViewProps) {
  const sequence = useMemo(() => parseSequence(pattern), [pattern]);

  const pad = 10;
  const cell = (100 - 2 * pad) / 3;

  const pos = useMemo(
    () => (n: number) => {
      const row = Math.floor((n - 1) / 3);
      const col = (n - 1) % 3;
      return { x: pad + col * cell, y: pad + row * cell };
    },
    [pad, cell],
  );

  const segments = useMemo(
    () =>
      sequence.slice(0, -1).map((_, i) => ({ from: sequence[i], to: sequence[i + 1] })),
    [sequence],
  );

  const togglePoint = useCallback(
    (n: number) => {
      if (!interactive || !onPatternChange) return;
      const cur = parseSequence(pattern);
      if (cur.includes(n)) {
        onPatternChange(cur.filter((x) => x !== n).join(''));
      } else {
        onPatternChange([...cur, n].join(''));
      }
    },
    [interactive, onPatternChange, pattern],
  );

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('select-none', interactive && 'cursor-default', className)}
      role="img"
      aria-label="圖形鎖路徑"
    >
      <defs>
        {segments.map((_, i) => {
          const c = COLORS[i % COLORS.length];
          return (
            <marker key={`m${i}`} id={`arr-${i}`} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
              <path d="M0,0 L7,2.5 L0,5 Z" fill={c} />
            </marker>
          );
        })}
      </defs>

      {segments.map((s, i) => {
        const from = pos(s.from);
        const to = pos(s.to);
        const c = COLORS[i % COLORS.length];
        return (
          <line
            key={`l${i}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={c}
            strokeWidth="2"
            strokeLinecap="round"
            markerEnd={`url(#arr-${i})`}
          />
        );
      })}

      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
        const order = sequence.indexOf(n);
        const isVisited = order >= 0;
        const color = isVisited ? COLORS[order % COLORS.length] : '#d1d5db';
        const fill = isVisited ? COLORS[order % COLORS.length] : '#ffffff';
        const textFill = isVisited ? '#ffffff' : '#6b7280';
        const label = isVisited ? order + 1 : n;
        const p = pos(n);

        return (
          <g
            key={n}
            onClick={() => togglePoint(n)}
            className={interactive ? 'cursor-pointer' : undefined}
          >
            <circle cx={p.x} cy={p.y} r="4" fill={fill} stroke={color} strokeWidth="1.5" />
            <text
              x={p.x}
              y={p.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="3"
              fill={textFill}
              fontWeight="600"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
