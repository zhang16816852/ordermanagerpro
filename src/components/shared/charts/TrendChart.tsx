import {
    Area,
    AreaChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    CartesianGrid,
} from "recharts";
import { formatCurrency } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TrendChartProps {
    data: any[];
    xKey: string;
    yKey: string;
    title?: string;
    subtitle?: string;
    color?: string;
    className?: string;
    height?: number;
    isLoading?: boolean;
}

export function TrendChart({
    data,
    xKey,
    yKey,
    title,
    subtitle,
    color = "hsl(var(--primary))",
    className,
    height = 300,
    isLoading
}: TrendChartProps) {
    if (isLoading) {
        return (
            <Card className={cn("shadow-soft border-none bg-card/60 backdrop-blur-sm", className)}>
                <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-48 mt-2" />
                </CardHeader>
                <CardContent className="pt-4">
                    <Skeleton className="w-full" style={{ height }} />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className={cn("shadow-soft border-none bg-card/60 backdrop-blur-sm", className)}>
            <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold flex items-center justify-between">
                    <div>
                        {title}
                        {subtitle && <p className="text-xs text-muted-foreground font-normal mt-1">{subtitle}</p>}
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
                <div style={{ width: '100%', height: height }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                            <XAxis
                                dataKey={xKey}
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                dy={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={(val) => `$${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}`}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "hsl(var(--background))",
                                    borderColor: "hsl(var(--border))",
                                    borderRadius: "12px",
                                    fontSize: "12px",
                                    fontWeight: "bold",
                                    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)"
                                }}
                                formatter={(value: number) => [formatCurrency(value), "金額"]}
                                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
                            />
                            <Area
                                type="monotone"
                                dataKey={yKey}
                                stroke={color}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorValue)"
                                animationDuration={1500}
                                activeDot={{ r: 6, strokeWidth: 0 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
}
