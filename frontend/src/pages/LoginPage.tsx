/**
 * Login page — JWT auth with show/hide password, remember me, forgot password link
 */
import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getErrorMessage, cn } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';
import { PasswordInput } from '../components/ui/PasswordInput';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  remember_me: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { remember_me: false },
  });

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (data: FormData) => {
    try {
      await login(data.email, data.password, data.remember_me);
      navigate('/', { replace: true });
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
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Brand */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1B3A5C] rounded-2xl mb-4 shadow-lg">
              <span className="text-white text-lg font-bold">TDS</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">26AS Matcher</h1>
            <p className="text-sm text-gray-500 mt-1">TDS Reconciliation Platform</p>
            <p className="text-xs text-gray-400 mt-0.5">HRA &amp; Co. / Akurat Advisory</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {/* Root error */}
            {errors.root && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errors.root.message}
              </div>
            )}

            {/* Email */}
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

            {/* Password with show/hide toggle */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-gray-700">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[#1B3A5C] hover:underline font-medium"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                autoComplete="current-password"
                placeholder="Enter your password"
                hasError={!!errors.password}
                {...register('password')}
              />
              {errors.password && (
                <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="remember_me"
                className="h-3.5 w-3.5 rounded border-gray-300 text-[#1B3A5C] focus:ring-[#1B3A5C]"
                {...register('remember_me')}
              />
              <label htmlFor="remember_me" className="text-xs text-gray-600 select-none">
                Remember me for 30 days
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg',
                'bg-[#1B3A5C] text-white text-sm font-semibold',
                'hover:bg-[#15304d] transition-colors',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                'mt-2',
              )}
            >
              {isSubmitting ? <Spinner size="sm" className="border-white/30 border-t-white" /> : null}
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {/* Links */}
          <div className="text-center space-y-2 mt-6">
            <p className="text-xs text-gray-400">
              Don't have an account?{' '}
              <Link to="/signup" className="text-[#1B3A5C] font-medium hover:underline">
                Create account
              </Link>
            </p>
            <p className="text-xs text-gray-400">
              First time?{' '}
              <Link to="/setup" className="text-[#1B3A5C] font-medium hover:underline">
                Set up admin account
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          Section 199 Income Tax Act &middot; Secure TDS Reconciliation
        </p>
      </div>
    </div>
  );
}
