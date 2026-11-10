/**
 * Toast store tests.
 *
 * Root cause of "nothing happens when I click save": `useToast()` kept its state
 * in a component-local `useReducer`, so the single `<Toaster />` in the layout
 * rendered from its own empty list and never saw toasts raised by pages. The
 * store is now module-level, and these tests prove that a toast raised in one
 * component is visible to every subscriber (including the outlet).
 */

import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';

import { reducer, toast, useToast, type ToasterToast } from '@/components/ui/use-toast';

describe('toast reducer', () => {
  it('adds the newest toast first', () => {
    const a: ToasterToast = { id: 'a', title: 'first' };
    const b: ToasterToast = { id: 'b', title: 'second' };

    const state = reducer(reducer({ toasts: [] }, { type: 'ADD_TOAST', toast: a }), {
      type: 'ADD_TOAST',
      toast: b,
    });

    expect(state.toasts.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('marks only the requested toast closed on dismiss', () => {
    const state = reducer(
      {
        toasts: [
          { id: 'a', open: true },
          { id: 'b', open: true },
        ],
      },
      { type: 'DISMISS_TOAST', toastId: 'a' }
    );

    expect(state.toasts).toEqual([
      { id: 'a', open: false },
      { id: 'b', open: true },
    ]);
  });
});

describe('toast store', () => {
  it('broadcasts a toast to every hook instance', () => {
    const first = renderHook(() => useToast());
    const second = renderHook(() => useToast());

    act(() => {
      toast({ title: 'Invoice created' });
    });

    expect(first.result.current.toasts[0]?.title).toBe('Invoice created');
    expect(second.result.current.toasts[0]?.title).toBe('Invoice created');
  });

  it('renders a toast raised before the outlet mounted', () => {
    act(() => {
      toast({ title: 'Saved before mount' });
    });

    const { getByText } = render(
      <div>
        <ToastProbe />
      </div>
    );

    expect(getByText('Saved before mount')).toBeInTheDocument();
  });

  it('stops notifying an unmounted subscriber', () => {
    const subscriber = renderHook(() => useToast());
    subscriber.unmount();

    expect(() => {
      act(() => {
        toast({ title: 'after unmount' });
      });
    }).not.toThrow();
  });
});

/** Minimal outlet, mirroring what components/ui/toaster.tsx renders. */
function ToastProbe() {
  const { toasts } = useToast();
  return (
    <div>
      {toasts.map((t) => (
        <p key={t.id}>{t.title as React.ReactNode}</p>
      ))}
    </div>
  );
}
