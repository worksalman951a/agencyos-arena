'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useBentoShell } from '@/components/providers/bento-theme-provider';
import { BentoPipelineFormView } from '@/components/crm/bento-pipeline-form-view';

interface EditPipelineFormProps {
  pipeline: {
    id: string;
    name: string;
    description: string | null;
    isDefault: boolean;
  };
}

export function EditPipelineForm({ pipeline }: EditPipelineFormProps) {
  const isBento = useBentoShell();
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<{
    name: string;
    description: string;
    isDefault: boolean;
  }>({
    defaultValues: {
      name: pipeline.name,
      description: pipeline.description || '',
      isDefault: pipeline.isDefault,
    },
  });

  const bentoName = form.watch('name');
  const bentoDesc = form.watch('description');
  const bentoDefault = form.watch('isDefault');

  React.useEffect(() => {
    if (pipeline) {
      form.reset({
        name: pipeline.name,
        description: pipeline.description || '',
        isDefault: pipeline.isDefault,
      });
    }
  }, [pipeline, form]);

  async function onSubmit(data: { name: string; description: string; isDefault: boolean }) {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/crm/pipelines/${pipeline.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          isDefault: data.isDefault,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || 'Failed to update pipeline');
        return;
      }

      router.push('/crm/pipelines');
      router.refresh();
    } catch {
      setError('Unable to update pipeline');
    } finally {
      setIsLoading(false);
    }
  }

  if (isBento) {
    return (
      <BentoPipelineFormView
        mode="edit"
        pipelineId={pipeline.id}
        name={bentoName}
        setName={(val) => form.setValue('name', val, { shouldDirty: true })}
        description={bentoDesc}
        setDescription={(val) => form.setValue('description', val, { shouldDirty: true })}
        isDefault={bentoDefault}
        setIsDefault={(val) => form.setValue('isDefault', val, { shouldDirty: true })}
        onSubmit={() => onSubmit(form.getValues())}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  // Legacy fallback view
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Edit Pipeline</CardTitle>
          <CardDescription>Update pipeline details</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2 mb-4">
              <span>{error}</span>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(form.getValues());
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <label htmlFor="name" className="block text-sm font-medium text-foreground">
                Pipeline Name
              </label>
              <Input
                id="name"
                placeholder="e.g. Sales Pipeline"
                {...form.register('name', { required: 'Pipeline name is required' })}
              />
              {form.formState.errors.name && (
                <span className="text-sm text-destructive">
                  {form.formState.errors.name.message}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="description" className="block text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                id="description"
                placeholder="Describe this pipeline..."
                className="flex h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...form.register('description')}
              />
            </div>
            <div className="flex items-center gap-3">
              <input
                id="isDefault"
                type="checkbox"
                className="w-4 h-4 rounded border-input bg-background text-accent ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                {...form.register('isDefault')}
              />
              <label htmlFor="isDefault" className="text-sm">
                Set as default pipeline
              </label>
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Updating...' : 'Update Pipeline'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
