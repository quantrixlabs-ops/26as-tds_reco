/**
 * QuarterDrilldownTab — Quarterly breakdown of matched pairs
 * Groups matched pairs by fiscal quarter using as26_date:
 *   Q1: Apr-Jun, Q2: Jul-Sep, Q3: Oct-Dec, Q4: Jan-Mar
 * Shows match count, total amount, average variance, and a volume bar.
 */
import { useQuery } from '@tanstack/react-query';
import { runsApi, type MatchedPair } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { cn, formatCurrency, formatPct } from '../lib/utils';

interface QuarterDrilldownTabProps {
  runId: string;
}

interface QuarterGroup {
  key: string;
  label: string;
  monthRange: string;
  count: number;
  totalAmount: number;
  avgVariancePct: number;
}

const QUARTER_META: Array<{
  key: string;
  label: string;
  monthRange: string;
  months: number[];
}> = [
  { key: 'Q1', label: 'Q1', monthRange: 'Apr - Jun', months: [4, 5, 6] },
  { key: 'Q2', label: 'Q2', monthRange: 'Jul - Sep', months: [7, 8, 9] },
  { key: 'Q3', label: 'Q3', monthRange: 'Oct - Dec', months: [10, 11, 12] },
  { key: 'Q4', label: 'Q4', monthRange: 'Jan - Mar', months: [1, 2, 3] },
];

function getQuarterKey(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1; // 1-based
    for (const q of QUARTER_META) {
      if (q.months.includes(month)) return q.key;
    }
    return null;
  } catch {
    return null;
  }
}

function groupByQuarter(pairs: MatchedPair[]): {
  quarters: QuarterGroup[];
  unmatched: QuarterGroup | null;
} {
  const buckets = new Map<
    string,
    { count: number; totalAmount: number; varianceSum: number }
  >();

  // Initialize all 4 quarters
  for (const q of QUARTER_META) {
    buckets.set(q.key, { count: 0, totalAmount: 0, varianceSum: 0 });
  }

  let unmatchedCount = 0;
  let unmatchedAmount = 0;
  let unmatchedVarianceSum = 0;

  for (const pair of pairs) {
    const qKey = getQuarterKey(pair.as26_date);
    if (qKey && buckets.has(qKey)) {
      const bucket = buckets.get(qKey)!;
      bucket.count += 1;
      bucket.totalAmount += pair.as26_amount;
      bucket.varianceSum += pair.variance_pct;
    } else {
      unmatchedCount += 1;
      unmatchedAmount += pair.as26_amount;
      unmatchedVarianceSum += pair.variance_pct;
    }
  }

  const quarters: QuarterGroup[] = QUARTER_META.map((q) => {
    const b = buckets.get(q.key)!;
    return {
      key: q.key,
      label: q.label,
      monthRange: q.monthRange,
      count: b.count,
      totalAmount: b.totalAmount,
      avgVariancePct: b.count > 0 ? b.varianceSum / b.count : 0,
    };
  });

  const unmatched: QuarterGroup | null =
    unmatchedCount > 0
      ? {
          key: 'NO_DATE',
          label: 'No Date',
          monthRange: 'Unmatched dates',
          count: unmatchedCount,
          totalAmount: unmatchedAmount,
          avgVariancePct:
            unmatchedCount > 0 ? unmatchedVarianceSum / unmatchedCount : 0,
        }
      : null;

  return { quarters, unmatched };
}

export default function QuarterDrilldownTab({ runId }: QuarterDrilldownTabProps) {
  const { data: pairs = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'matched'],
    queryFn: () => runsApi.matched(runId),
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-gray-400">Loading quarterly breakdown...</p>
        </div>
      </Card>
    );
  }

  if (pairs.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-400 text-center py-8">
          No matched pairs to analyze
        </p>
      </Card>
    );
  }

  const { quarters, unmatched } = groupByQuarter(pairs);
  const allRows = unmatched ? [...quarters, unmatched] : quarters;
  const maxCount = Math.max(...allRows.map((r) => r.count), 1);
  const totalCount = allRows.reduce((s, r) => s + r.count, 0);
  const totalAmount = allRows.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-500">
          Quarterly distribution of {totalCount} matched pairs
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#1B3A5C] text-white">
              <th className="text-left px-4 py-2.5 text-xs font-semibold">
                Quarter
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Matches
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Total Amount
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Avg Variance
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold w-1/3">
                Volume
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {quarters.map((q) => (
              <tr key={q.key} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#1B3A5C] text-xs">
                      {q.label}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {q.monthRange}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {q.count}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {formatCurrency(q.totalAmount)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={cn(
                      'font-mono text-xs',
                      q.count === 0
                        ? 'text-gray-300'
                        : q.avgVariancePct > 3
                        ? 'text-red-600'
                        : q.avgVariancePct > 1
                        ? 'text-amber-600'
                        : 'text-gray-700',
                    )}
                  >
                    {q.count > 0 ? formatPct(q.avgVariancePct) : '--'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#1B3A5C] transition-all"
                        style={{
                          width: `${maxCount > 0 ? (q.count / maxCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right shrink-0">
                      {totalCount > 0
                        ? `${((q.count / totalCount) * 100).toFixed(0)}%`
                        : '0%'}
                    </span>
                  </div>
                </td>
              </tr>
            ))}

            {unmatched && (
              <tr className="hover:bg-gray-50 transition-colors bg-amber-50/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="yellow" size="sm">
                      {unmatched.label}
                    </Badge>
                    <span className="text-[10px] text-gray-400">
                      {unmatched.monthRange}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {unmatched.count}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {formatCurrency(unmatched.totalAmount)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={cn(
                      'font-mono text-xs',
                      unmatched.avgVariancePct > 3
                        ? 'text-red-600'
                        : unmatched.avgVariancePct > 1
                        ? 'text-amber-600'
                        : 'text-gray-700',
                    )}
                  >
                    {formatPct(unmatched.avgVariancePct)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-400 transition-all"
                        style={{
                          width: `${maxCount > 0 ? (unmatched.count / maxCount) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right shrink-0">
                      {totalCount > 0
                        ? `${((unmatched.count / totalCount) * 100).toFixed(0)}%`
                        : '0%'}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
              <td className="px-4 py-2.5 text-xs text-gray-700">Total</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">
                {totalCount}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">
                {formatCurrency(totalAmount)}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-500">
                --
              </td>
              <td className="px-4 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
