'use client';

import * as React from 'react';

import { useToast, ToastProvider } from '@/components/ui/use-toast';
import {
  Provider as ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
} from '@/components/ui/toast';

function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      <ToastViewport>
        {toasts.map(function ({ id, title, description, action, variant, ...props }) {
          return (
            <Toast
              key={id}
              className={
                variant === 'destructive' ? 'border-destructive/50 bg-destructive/10' : undefined
              }
              {...props}
            >
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
              {action}
            </Toast>
          );
        })}
      </ToastViewport>
    </ToastProvider>
  );
}

export { Toaster };

export { useToast };
