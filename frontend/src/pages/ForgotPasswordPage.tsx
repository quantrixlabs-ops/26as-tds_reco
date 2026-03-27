/**
 * Forgot Password page — request password reset email
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, AlertCircle, KeyRound, CheckCircle2, ArrowLeft } from 'lucide-react';
import { authApi } from '../lib/api';
import { getErrorMessage, cn } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
});

type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      await authApi.forgotPassword(data.email);
      setSent(true);
    } catch (err) {
      setError('root', { message: getErrorMessage(err) });
    }
  };

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full pl-10 pr-4 py-2.5 text-sm border rounded-lg outline-none transition-colors',
      'text-gray-900 placeholder-gray-400 bg-white',
      hasError
        ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
        : 'border-gray-300 focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10',
    );

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f2540] to-[#1B3A5C] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {sent ? (
            /* Success state */
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mb-4">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
              <h1 className="text-xl font-bold text-gray-900 mb-2">Check Your Email</h1>
              <p className="text-sm text-gray-500 mb-6">
                If an account exists with that email, we've sent a password reset link.
                The link expires in 1 hour.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-lg bg-[#1B3A5C] text-white text-sm font-semibold hover:bg-[#15304d] transition-colors"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1B3A5C] rounded-2xl mb-4 shadow-lg">
                  <KeyRound className="text-white h-7 w-7" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">Forgot Password?</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Enter your email and we'll send you a reset link
                </p>
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
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@firm.com"
                      className={inputClass(!!errors.email)}
                      {...register('email')}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={cn(
                    'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg',
                    'bg-[#1B3A5C] text-white text-sm font-semibold',
                    'hover:bg-[#15304d] transition-colors',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                  )}
                >
                  {isSubmitting && <Spinner size="sm" className="border-white/30 border-t-white" />}
                  {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>

              <Link
                to="/login"
                className="flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-[#1B3A5C] mt-6 transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Sign In
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
