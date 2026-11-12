'use client';

import * as React from 'react';

const BentoShellContext = React.createContext<boolean>(false);

export function BentoShellProvider({
  isBento,
  children,
}: {
  isBento: boolean;
  children: React.ReactNode;
}) {
  return <BentoShellContext.Provider value={isBento}>{children}</BentoShellContext.Provider>;
}

export function useBentoShell(): boolean {
  return React.useContext(BentoShellContext);
}
