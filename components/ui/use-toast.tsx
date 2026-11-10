'use client';

/**
 * Toast store (shadcn/ui pattern).
 *
 * The state lives in this module, not inside the hook. Earlier the hook used a
 * local `useReducer`, which meant every component that called `useToast()` had
 * its own private list of toasts - and the single `<Toaster />` mounted in the
 * layout rendered from *its* own (always empty) list. In practice no toast was
 * ever displayed anywhere in the app.
 *
 * With a module-level store, `toast(...)` from any component is broadcast to
 * every subscriber, so the one `<Toaster />` in the application shell shows
 * messages raised from any page.
 */

import * as React from 'react';

const TOAST_LIMIT = 5;

type ToastActionElement = React.ReactNode;

export type ToasterToast = {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  variant?: 'default' | 'destructive' | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  [key: string]: unknown;
};

const actionTypes = {
  ADD_TOAST: 'ADD_TOAST',
  DISMISS_TOAST: 'DISMISS_TOAST',
  REMOVE_TOAST: 'REMOVE_TOAST',
} as const;

type State = {
  toasts: ToasterToast[];
};

type Action =
  | {
      type: typeof actionTypes.ADD_TOAST;
      toast: ToasterToast;
    }
  | {
      type: typeof actionTypes.DISMISS_TOAST;
      toastId?: ToasterToast['id'];
    }
  | {
      type: typeof actionTypes.REMOVE_TOAST;
      toastId?: ToasterToast['id'];
    };

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      if (!toastId) {
        return {
          ...state,
          toasts: state.toasts.map((t) =>
            t.id === toastId || toastId === undefined ? { ...t, open: false } : t
          ),
        };
      }

      return {
        ...state,
        toasts: state.toasts.map((t) => (t.id === toastId ? { ...t, open: false } : t)),
      };
    }

    case actionTypes.REMOVE_TOAST:
      if (!action.toastId) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };

    default:
      return state;
  }
}

/** Module-level store shared by every hook instance. */
let memoryState: State = { toasts: [] };
const listeners = new Set<() => void>();

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  for (const listener of listeners) listener();
}

/** Read the current snapshot; a new object is created on every change. */
const getSnapshot = () => memoryState;

/**
 * Server snapshot is a constant empty state: the store must not leak toasts
 * between requests during SSR, and the initial client render has to match the
 * server markup.
 */
const serverSnapshot: State = { toasts: [] };
const getServerSnapshot = () => serverSnapshot;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type ToastInput = Omit<ToasterToast, 'id' | 'open' | 'onOpenChange'>;

/** Raise a toast from anywhere (component or plain helper module). */
export function toast(props: ToastInput) {
  const id = genId();

  const update = (next: ToasterToast) =>
    dispatch({
      type: actionTypes.ADD_TOAST,
      toast: { ...next, id },
    });

  const dismiss = (toastId?: string) =>
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: toastId ?? id });

  update({
    ...props,
    id,
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) dismiss();
    },
  });

  return {
    id,
    dismiss,
    update: (next: ToastInput) =>
      dispatch({
        type: actionTypes.ADD_TOAST,
        toast: { ...next, id },
      }),
  };
}

function useToast() {
  // useSyncExternalStore subscribes to the module store, so the outlet and any
  // component that raises a toast always observe the same list.
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: actionTypes.DISMISS_TOAST, toastId }),
  };
}

export { useToast };

/** Toast provider component (kept for API compatibility; store is global) */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
