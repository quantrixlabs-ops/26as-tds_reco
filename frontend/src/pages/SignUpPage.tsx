/**
 * Sign Up page — self-registration with password strength + security questions
 */
import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Mail, AlertCircle, UserPlus, ShieldQuestion, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { authApi } from '../lib/api';
import { getErrorMessage, cn } from '../lib/utils';
import { Spinner } from '../components/ui/Spinner';
import { PasswordInput } from '../components/ui/PasswordInput';
import { PasswordStrengthMeter } from '../components/ui/PasswordStrengthMeter';
import { useToast } from '../components/ui/Toast';

const SECURITY_QUESTION_OPTIONS = [
  "What was your first pet's name?",
  "What is your mother's maiden name?",
  "In what city were you born?",
  "What was the name of your favorite teacher?",
  "What is the name of the street you grew up on?",
  "What was your childhood nickname?",
  "What is your favorite book?",
  "What was the make of your first car?",
];

const schema = z
  .object({
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Enter a valid email'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Z]/, 'Must include an uppercase letter')
      .regex(/[a-z]/, 'Must include a lowercase letter')
      .regex(/\d/, 'Must include a number')
      .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/, 'Must include a special character'),
    confirm_password: z.string().min(1, 'Please confirm password'),
    sq1_question: z.string().min(1, 'Select a security question'),
    sq1_answer: z.string().min(2, 'Answer must be at least 2 characters'),
    sq2_question: z.string().min(1, 'Select a security question'),
    sq2_answer: z.string().min(2, 'Answer must be at least 2 characters'),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })
  .refine((d) => d.sq1_question !== d.sq2_question, {
    message: 'Please select different questions',
    path: ['sq2_question'],
  });

type FormData = z.infer<typeof schema>;

export default function SignUpPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const passwordValue = watch('password', '');

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const onSubmit = async (data: FormData) => {
    try {
      await authApi.register({
        email: data.email,
        password: data.password,
        full_name: data.full_name,
        security_questions: [
          { question: data.sq1_question, answer: data.sq1_answer },
          { question: data.sq2_question, answer: data.sq2_answer },
        ],
      });
      setSuccess(true);
      toast('Account created!', 'Check your email for a verification link.', 'success');
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (typeof detail === 'object' && detail?.errors) {
        setError('root', { message: detail.errors.join('. ') });
      } else {
        setError('root', { message: getErrorMessage(err) });
      }
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

  const selectClass = (hasError: boolean) =>
    cn(
      'w-full pl-3 pr-4 py-2.5 text-sm border rounded-lg outline-none transition-colors',
      'text-gray-900 bg-white appearance-none',
      hasError
        ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
        : 'border-gray-300 focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10',
    );

  // Success state
  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0f2540] to-[#1B3A5C] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Check Your Email</h1>
            <p className="text-sm text-gray-500 mb-6">
              We've sent a verification link to your email address.
              Please click the link to verify your account before signing in.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-lg bg-[#1B3A5C] text-white text-sm font-semibold hover:bg-[#15304d] transition-colors"
            >
              Go to Sign In
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
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[#1B3A5C] rounded-2xl mb-4 shadow-lg">
              <UserPlus className="text-white h-7 w-7" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Create Account</h1>
            <p className="text-sm text-gray-500 mt-1">26AS Matcher — TDS Reconciliation Platform</p>
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
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Full name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Ravi Kumar"
                  className={inputClass(!!errors.full_name)}
                  {...register('full_name')}
                />
              </div>
              {errors.full_name && <p className="text-xs text-red-600 mt-1">{errors.full_name.message}</p>}
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email address</label>
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
              {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Min 8 characters"
                hasError={!!errors.password}
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>}
              <PasswordStrengthMeter password={passwordValue} />
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5">Confirm password</label>
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

            {/* Security Questions */}
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2 mb-3">
                <ShieldQuestion className="h-4 w-4 text-[#1B3A5C]" />
                <span className="text-xs font-semibold text-gray-700">Security Questions</span>
                <span className="text-[10px] text-gray-400">(for password recovery)</span>
              </div>

              {/* Question 1 */}
              <div className="space-y-2 mb-3">
                <select className={selectClass(!!errors.sq1_question)} {...register('sq1_question')}>
                  <option value="">Select a question...</option>
                  {SECURITY_QUESTION_OPTIONS.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                {errors.sq1_question && <p className="text-xs text-red-600">{errors.sq1_question.message}</p>}
                <input
                  type="text"
                  placeholder="Your answer"
                  className={cn(
                    'w-full pl-3 pr-4 py-2 text-sm border rounded-lg outline-none transition-colors',
                    'text-gray-900 placeholder-gray-400 bg-white',
                    errors.sq1_answer
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-300 focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10',
                  )}
                  {...register('sq1_answer')}
                />
                {errors.sq1_answer && <p className="text-xs text-red-600">{errors.sq1_answer.message}</p>}
              </div>

              {/* Question 2 */}
              <div className="space-y-2">
                <select className={selectClass(!!errors.sq2_question)} {...register('sq2_question')}>
                  <option value="">Select a question...</option>
                  {SECURITY_QUESTION_OPTIONS.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
                {errors.sq2_question && <p className="text-xs text-red-600">{errors.sq2_question.message}</p>}
                <input
                  type="text"
                  placeholder="Your answer"
                  className={cn(
                    'w-full pl-3 pr-4 py-2 text-sm border rounded-lg outline-none transition-colors',
                    'text-gray-900 placeholder-gray-400 bg-white',
                    errors.sq2_answer
                      ? 'border-red-400 focus:border-red-500'
                      : 'border-gray-300 focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10',
                  )}
                  {...register('sq2_answer')}
                />
                {errors.sq2_answer && <p className="text-xs text-red-600">{errors.sq2_answer.message}</p>}
              </div>
            </div>

            {/* Submit */}
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
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-[#1B3A5C] font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          Section 199 Income Tax Act &middot; Secure TDS Reconciliation
        </p>
      </div>
    </div>
  );
}
