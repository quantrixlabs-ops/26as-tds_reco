/**
 * AdminPage — user management (ADMIN only)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus, Users, Shield, AlertCircle, Mail, Lock, User } from 'lucide-react';
import { authApi, type Role, type User as UserType } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, type Column } from '../components/ui/Table';
import { FullPageSpinner } from '../components/ui/Spinner';
import { useToast } from '../components/ui/Toast';
import { roleVariant, getErrorMessage, cn } from '../lib/utils';

const schema = z
  .object({
    full_name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Minimum 8 characters'),
    confirm_password: z.string().min(1, 'Confirm password'),
    role: z.enum(['ADMIN', 'REVIEWER', 'PREPARER'] as const),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type FormData = z.infer<typeof schema>;

const ROLE_OPTIONS: Array<{ value: Role; label: string; desc: string }> = [
  {
    value: 'PREPARER',
    label: 'Preparer',
    desc: 'Can upload files and start reconciliation runs',
  },
  {
    value: 'REVIEWER',
    label: 'Reviewer',
    desc: 'Can approve or reject runs prepared by others',
  },
  {
    value: 'ADMIN',
    label: 'Admin',
    desc: 'Full access including user management',
  },
];

function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'PREPARER' },
  });

  const mut = useMutation({
    mutationFn: (data: FormData) =>
      authApi.createUser(data.email, data.password, data.full_name, data.role),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('User created', `${user.full_name} (${user.role})`, 'success');
      reset();
      onSuccess();
    },
    onError: (err) => {
      setError('root', { message: getErrorMessage(err) });
    },
  });

  const inputClass = (hasError: boolean) =>
    cn(
      'w-full pl-9 pr-4 py-2.5 text-sm border rounded-lg outline-none transition-colors',
      hasError
        ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100'
        : 'border-gray-300 focus:border-[#1B3A5C] focus:ring-2 focus:ring-[#1B3A5C]/10',
    );

  return (
    <form onSubmit={handleSubmit((d) => mut.mutate(d))} noValidate className="space-y-4">
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
            placeholder="user@firm.com"
            className={inputClass(!!errors.email)}
            {...register('email')}
          />
        </div>
        {errors.email && (
          <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="password"
              placeholder="Min 8 chars"
              className={inputClass(!!errors.password)}
              {...register('password')}
            />
          </div>
          {errors.password && (
            <p className="text-xs text-red-600 mt-1">{errors.password.message}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5">
            Confirm password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="password"
              placeholder="Repeat"
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
      </div>

      {/* Role */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1.5">Role</label>
        <div className="space-y-2">
          {ROLE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
            >
              <input
                type="radio"
                value={opt.value}
                className="mt-0.5"
                {...register('role')}
              />
              <div>
                <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                <p className="text-xs text-gray-500">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
        {errors.role && (
          <p className="text-xs text-red-600 mt-1">{errors.role.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || mut.isPending}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg',
          'bg-[#1B3A5C] text-white text-sm font-semibold',
          'hover:bg-[#15304d] transition-colors',
          'disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        <UserPlus className="h-4 w-4" />
        {mut.isPending ? 'Creating…' : 'Create user'}
      </button>
    </form>
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const [showForm, setShowForm] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: authApi.users,
  });

  const cols: Column<UserType>[] = [
    {
      key: 'full_name',
      header: 'Name',
      sortable: true,
      render: (u) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#1B3A5C]/10 flex items-center justify-center text-[#1B3A5C] text-xs font-semibold shrink-0">
            {u.full_name[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{u.full_name}</p>
            {u.id === me?.id && (
              <p className="text-xs text-gray-400">(you)</p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortable: true,
      render: (u) => <span className="text-sm text-gray-600">{u.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      render: (u) => <Badge variant={roleVariant(u.role)}>{u.role}</Badge>,
    },
    {
      key: 'id',
      header: 'User ID',
      render: (u) => (
        <span className="font-mono text-xs text-gray-400">{u.id.slice(0, 8)}…</span>
      ),
    },
  ];

  if (isLoading) return <FullPageSpinner message="Loading users…" />;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Administration</h1>
          <p className="text-sm text-gray-500 mt-0.5">User management and platform settings</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B3A5C] text-white text-sm font-semibold rounded-lg hover:bg-[#15304d] transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          {showForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {/* Maker-checker notice */}
      <Card className="bg-blue-50 border-blue-100 flex gap-3">
        <Shield className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Maker-Checker Policy</p>
          <p className="text-xs text-blue-600 mt-1">
            A PREPARER cannot approve or reject runs they submitted.
            REVIEWER/ADMIN with <code className="bg-blue-100 px-1 rounded">run.created_by !== user.id</code>{' '}
            can perform approval actions. This separation is enforced by the backend.
          </p>
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* User list */}
        <div className="lg:col-span-2">
          <Card padding={false}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-400" />
              <p className="text-sm font-semibold text-gray-900">
                Users ({users.length})
              </p>
            </div>
            <Table
              columns={cols}
              data={users}
              keyExtractor={(u) => u.id}
              emptyMessage="No users found"
            />
          </Card>
        </div>

        {/* Create user form */}
        {showForm && (
          <div>
            <Card>
              <CardHeader title="Create New User" />
              <CreateUserForm onSuccess={() => setShowForm(false)} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
