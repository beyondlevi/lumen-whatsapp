import {createContext, useContext, type ReactNode} from 'react';
import {useWhatsAppState, type WhatsAppState} from './state/useWhatsAppState';

export type {Phase, Thread} from './state/useWhatsAppState';

const WhatsAppContext = createContext<WhatsAppState | null>(null);

/** Durable connection, chat, and thread state; lives outside the route transition. */
export function WhatsAppProvider({children}: {children: ReactNode}) {
  const state = useWhatsAppState();
  return <WhatsAppContext.Provider value={state}>{children}</WhatsAppContext.Provider>;
}

export function useWhatsApp(): WhatsAppState {
  const context = useContext(WhatsAppContext);
  if (context == null) {
    throw new Error('useWhatsApp must be used within WhatsAppProvider');
  }
  return context;
}
