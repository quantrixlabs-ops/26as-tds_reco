/**
 * SetupPage — first-time admin account creation
 */
import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Mail, Lock, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { getErrorMessage, cn } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';

const schema = z
  .object({
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string().min(1, 'Please confirm password'),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type FormData = z.infer<typeof schema>;

export default function SetupPage() {
  const { setupAdmin, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (data: FormData) => {
    try {
      await setupAdmin(data.email, data.password, data.full_name);
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
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1B3A5C] rounded-2xl mb-4 shadow-lg">
              <ShieldCheck className="text-white h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Initial Setup</h1>
            <p className="text-sm text-gray-500 mt-1">Create the first administrator account</p>
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              This form is only available before any users are registered.
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {errors.root && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errors.root.message}
              </div>
            )}

            {/* Full name */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Full name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Ravi Kumar"
                  className={inputClass(!!errors.full_name)}
                  {...register('full_name')}
                />
              </div>
              {errors.full_name && (
                <p className="text-xs text-red-600 mt-1">{errors.full_name.message}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  placeholder="admin@firm.com"
                  className={inputClass(!!errors.email)}
                  {...register('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="password"
                  placeholder="At least 8 characters"
                  className={inputClass(!!errors.password)}
                  {...register('password')}
                />
              </div>
              {errors.password && (
                <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="password"
                  placeholder="Repeat password"
                  className={inputClass(!!errors.confirm_password)}
                  {...register('confirm_password')}
                />
              </div>
              {errors.confirm_password && (
                <p className="text-xs text-red-600 mt-1">
                  {errors.confirm_password.message}
                </p>
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
              {isSubmitting && (
                <Spinner size="sm" className="border-white/30 border-t-white" />
              )}
              {isSubmitting ? 'Creating account…' : 'Create admin account'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Already set up?{' '}
            <Link to="/login" className="text-[#1B3A5C] font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
