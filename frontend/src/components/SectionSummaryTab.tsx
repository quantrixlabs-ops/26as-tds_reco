/**
 * SectionSummaryTab — TDS section-wise breakdown of matched pairs
 * Groups matched pairs by section code (e.g., 194C, 194J, 194H) and shows
 * aggregate statistics per section.
 */
import { useQuery } from '@tanstack/react-query';
import { runsApi, type MatchedPair, type ConfidenceTier } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { cn, formatCurrency, formatPct, confidenceVariant } from '../lib/utils';

interface SectionSummaryTabProps {
  runId: string;
}

interface SectionGroup {
  section: string;
  count: number;
  totalAs26Amount: number;
  totalBooksSum: number;
  avgVariancePct: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

function groupBySection(pairs: MatchedPair[]): SectionGroup[] {
  const map = new Map<
    string,
    {
      count: number;
      totalAs26Amount: number;
      totalBooksSum: number;
      varianceSum: number;
      highCount: number;
      mediumCount: number;
      lowCount: number;
    }
  >();

  for (const pair of pairs) {
    const key = pair.section || 'Unknown';
    const entry = map.get(key) ?? {
      count: 0,
      totalAs26Amount: 0,
      totalBooksSum: 0,
      varianceSum: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
    };

    entry.count += 1;
    entry.totalAs26Amount += pair.as26_amount;
    entry.totalBooksSum += pair.books_sum;
    entry.varianceSum += pair.variance_pct;

    const tier: ConfidenceTier = pair.confidence;
    if (tier === 'HIGH') entry.highCount += 1;
    else if (tier === 'MEDIUM') entry.mediumCount += 1;
    else entry.lowCount += 1;

    map.set(key, entry);
  }

  const groups: SectionGroup[] = [];
  for (const [section, entry] of map) {
    groups.push({
      section,
      count: entry.count,
      totalAs26Amount: entry.totalAs26Amount,
      totalBooksSum: entry.totalBooksSum,
      avgVariancePct: entry.count > 0 ? entry.varianceSum / entry.count : 0,
      highCount: entry.highCount,
      mediumCount: entry.mediumCount,
      lowCount: entry.lowCount,
    });
  }

  // Sort by total 26AS amount descending
  groups.sort((a, b) => b.totalAs26Amount - a.totalAs26Amount);
  return groups;
}

export default function SectionSummaryTab({ runId }: SectionSummaryTabProps) {
  const { data: pairs = [], isLoading } = useQuery({
    queryKey: ['runs', runId, 'matched'],
    queryFn: () => runsApi.matched(runId),
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-gray-400">Loading section summary...</p>
        </div>
      </Card>
    );
  }

  const groups = groupBySection(pairs);

  if (groups.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-400 text-center py-8">
          No matched pairs to summarize
        </p>
      </Card>
    );
  }

  const totalMatches = groups.reduce((s, g) => s + g.count, 0);
  const totalAs26 = groups.reduce((s, g) => s + g.totalAs26Amount, 0);
  const totalBooks = groups.reduce((s, g) => s + g.totalBooksSum, 0);

  return (
    <Card padding={false}>
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-500">
          {groups.length} sections across {totalMatches} matched pairs
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#1B3A5C] text-white">
              <th className="text-left px-4 py-2.5 text-xs font-semibold">
                Section
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Matches
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                26AS Amount
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Books Sum
              </th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold">
                Avg Variance
              </th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold">
                Confidence Distribution
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((group) => (
              <tr key={group.section} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-semibold text-[#1B3A5C]">
                    {group.section}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {group.count}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {formatCurrency(group.totalAs26Amount)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-xs text-gray-700">
                    {formatCurrency(group.totalBooksSum)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={cn(
                      'font-mono text-xs',
                      group.avgVariancePct > 3
                        ? 'text-red-600'
                        : group.avgVariancePct > 1
                        ? 'text-amber-600'
                        : 'text-gray-700',
                    )}
                  >
                    {formatPct(group.avgVariancePct)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1.5">
                    {group.highCount > 0 && (
                      <Badge variant={confidenceVariant('HIGH')} size="sm">
                        H: {group.highCount}
                      </Badge>
                    )}
                    {group.mediumCount > 0 && (
                      <Badge variant={confidenceVariant('MEDIUM')} size="sm">
                        M: {group.mediumCount}
                      </Badge>
                    )}
                    {group.lowCount > 0 && (
                      <Badge variant={confidenceVariant('LOW')} size="sm">
                        L: {group.lowCount}
                      </Badge>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold border-t border-gray-200">
              <td className="px-4 py-2.5 text-xs text-gray-700">Total</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">
                {totalMatches}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">
                {formatCurrency(totalAs26)}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">
                {formatCurrency(totalBooks)}
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
