/**
 * Reset Password page — set new password using reset token from email
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, KeyRound, CheckCircle2 } from 'lucide-react';
import { authApi } from '../lib/api';
import { getErrorMessage, cn } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';
import { PasswordInput } from '../components/ui/PasswordInput';
import { PasswordStrengthMeter } from '../components/ui/PasswordStrengthMeter';

const schema = z
  .object({
    new_password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[a-z]/, 'Must include a lowercase letter')
      .regex(/\d/, 'Must include a number')
      .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, 'Must include a special character'),
    confirm_password: z.string().min(1, 'Please confirm password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const passwordValue = watch('new_password', '');

  const onSubmit = async (data: FormData) => {
    if (!token) {
      setError('root', { message: 'Invalid reset link. Please request a new one.' });
      return;
    }
    try {
      await authApi.resetPassword(token, data.new_password);
      setSuccess(true);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'object' && detail?.errors) {
        setError('root', { message: detail.errors.join('. ') });
      } else {
        setError('root', { message: getErrorMessage(err) });
      }
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0f2540] to-[#1B3A5C] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-full mb-4">
              <AlertCircle className="h-7 w-7 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid Reset Link</h1>
            <p className="text-sm text-gray-500 mb-6">
              This password reset link is invalid or has expired.
            </p>
            <Link
              to="/forgot-password"
              className="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-lg bg-[#1B3A5C] text-white text-sm font-semibold hover:bg-[#15304d] transition-colors"
            >
              Request New Reset Link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0f2540] to-[#1B3A5C] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Password Reset Successfully</h1>
            <p className="text-sm text-gray-500 mb-6">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-lg bg-[#1B3A5C] text-white text-sm font-semibold hover:bg-[#15304d] transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f2540] to-[#1B3A5C] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1B3A5C] rounded-2xl mb-4 shadow-lg">
              <KeyRound className="text-white h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Set New Password</h1>
            <p className="text-sm text-gray-500 mt-1">Choose a strong password for your account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {errors.root && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errors.root.message}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                New password
              </label>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Min 8 characters"
                hasError={!!errors.new_password}
                {...register('new_password')}
              />
              {errors.new_password && (
                <p className="text-xs text-red-600 mt-1">{errors.new_password.message}</p>
              )}
              <PasswordStrengthMeter password={passwordValue} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Confirm new password
              </label>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Repeat password"
                hasError={!!errors.confirm_password}
                {...register('confirm_password')}
              />
              {errors.confirm_password && (
                <p className="text-xs text-red-600 mt-1">{errors.confirm_password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg mt-2',
                'bg-[#1B3A5C] text-white text-sm font-semibold',
                'hover:bg-[#15304d] transition-colors',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              {isSubmitting && <Spinner size="sm" className="border-white/30 border-t-white" />}
              {isSubmitting ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
