'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInEmail } from '@/lib/auth-client';
import { useRouter } from 'next/navigation';
import { Mail, Lock, AlertTriangle } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(data: LoginFormData) {
    setError(null);
    setIsLoading(true);
    try {
      const requestedInvite = new URLSearchParams(window.location.search).get('invite');
      const returnTo =
        requestedInvite && /^[A-Za-z0-9_-]{20,200}$/.test(requestedInvite)
          ? `/invite/${encodeURIComponent(requestedInvite)}`
          : '/dashboard';
      await signInEmail({
        email: data.email,
        password: data.password,
        callbackUrl: returnTo,
      });
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome back</CardTitle>
          <CardDescription>Sign in to your AgencyOS workspace</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="w-4 h-4 shrink-0" />
                  <label htmlFor="email">Email address</label>
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@agency.com"
                  {...form.register('email')}
                />
                {form.formState.errors.email && (
                  <span className="text-sm text-destructive">
                    {form.formState.errors.email.message}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="w-4 h-4 shrink-0" />
                  <label htmlFor="password">Password</label>
                </div>
                <Input id="password" type="password" {...form.register('password')} />
                {form.formState.errors.password && (
                  <span className="text-sm text-destructive">
                    {form.formState.errors.password.message}
                  </span>
                )}
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
            <p className="text-center text-sm">
              <a href="/forgot-password" className="text-accent hover:underline">
                Forgot your password?
              </a>
            </p>
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <a href="/register" className="text-accent hover:underline">
                Create one
              </a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
