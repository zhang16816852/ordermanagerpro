import {
    PieChart,
    Pie,
    Cell,
    ResponsiveContainer,
    Tooltip,
    Legend
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface PieDistributionChartProps {
    data: { name: string, value: number, color?: string }[];
    title?: string;
    subtitle?: string;
    className?: string;
    height?: number;
    innerRadius?: number;
    isLoading?: boolean;
}

const DEFAULT_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--success))",
    "hsl(var(--warning))",
    "hsl(var(--accent))",
    "#8B5CF6",
    "#EC4899",
    "#F59E0B",
    "#10B981"
];

export function PieDistributionChart({
    data,
    title,
    subtitle,
    className,
    height = 300,
    innerRadius = 60,
    isLoading
}: PieDistributionChartProps) {
    if (isLoading) {
        return (
            <Card className={cn("shadow-soft border-none bg-card/60 backdrop-blur-sm", className)}>
                <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-48 mt-2" />
                </CardHeader>
                <CardContent className="flex items-center justify-center" style={{ height }}>
                    <Skeleton className="h-32 w-32 rounded-full" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={cn("shadow-soft border-none bg-card/60 backdrop-blur-sm", className)}>
            <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold">
                    {title}
                    {subtitle && <p className="text-xs text-muted-foreground font-normal mt-1">{subtitle}</p>}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div style={{ width: '100%', height: height }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={innerRadius}
                                outerRadius={innerRadius + 30}
                                paddingAngle={5}
                                dataKey="value"
                                stroke="transparent"
                                animationDuration={1000}
                                animationBegin={200}
                            >
                                {data.map((entry, index) => (
                                    <Cell 
                                        key={`cell-${index}`} 
                                        fill={entry.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]} 
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "hsl(var(--background))",
                                    borderColor: "hsl(var(--border))",
                                    borderRadius: "12px",
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)"
                                }}
                            />
                            <Legend 
                                verticalAlign="bottom" 
                                height={36} 
                                iconType="circle"
                                wrapperStyle={{ fontSize: '10px', paddingTop: '20px' }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
