/**
 * Real-time password strength meter with visual bar + label.
 * Computed client-side for instant feedback.
 */
import { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { Check, X } from 'lucide-react';

interface PasswordStrengthMeterProps {
  password: string;
}

interface StrengthResult {
  score: number; // 0–4
  label: string;
  color: string;
  bgColor: string;
  checks: { label: string; passed: boolean }[];
}

function computeStrength(password: string): StrengthResult {
  const checks = [
    { label: 'At least 8 characters', passed: password.length >= 8 },
    { label: 'Uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', passed: /[a-z]/.test(password) },
    { label: 'Number', passed: /\d/.test(password) },
    { label: 'Special character (!@#$%...)', passed: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password) },
  ];

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;

  let diversity = 0;
  if (/[A-Z]/.test(password)) diversity += 1;
  if (/[a-z]/.test(password)) diversity += 1;
  if (/\d/.test(password)) diversity += 1;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) diversity += 1;

  if (diversity >= 3) score += 1;
  if (diversity >= 4) score += 1;

  score = Math.min(4, score);

  const levels = [
    { label: 'Weak', color: 'text-red-600', bgColor: 'bg-red-500' },
    { label: 'Fair', color: 'text-orange-600', bgColor: 'bg-orange-500' },
    { label: 'Good', color: 'text-yellow-600', bgColor: 'bg-yellow-500' },
    { label: 'Strong', color: 'text-emerald-600', bgColor: 'bg-emerald-500' },
    { label: 'Very Strong', color: 'text-emerald-700', bgColor: 'bg-emerald-600' },
  ];

  const level = levels[score];

  return {
    score,
    label: level.label,
    color: level.color,
    bgColor: level.bgColor,
    checks,
  };
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const result = useMemo(() => computeStrength(password), [password]);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Strength bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                i <= result.score - 1 ? result.bgColor : 'bg-gray-200',
              )}
            />
          ))}
        </div>
        <span className={cn('text-xs font-medium', result.color)}>
          {result.label}
        </span>
      </div>

      {/* Requirement checklist */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        {result.checks.map((check) => (
          <div key={check.label} className="flex items-center gap-1.5">
            {check.passed ? (
              <Check className="h-3 w-3 text-emerald-500 shrink-0" />
            ) : (
              <X className="h-3 w-3 text-gray-300 shrink-0" />
            )}
            <span
              className={cn(
                'text-[11px]',
                check.passed ? 'text-emerald-600' : 'text-gray-400',
              )}
            >
              {check.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
