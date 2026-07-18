import { useEffect, type ReactNode } from 'react';
import { useModalLayerStore } from './modalLayerStore';

/** Registers one mounted Radix modal surface for guidance layering and focus. */
export function ModalLayerRegistration({ children }: { children: ReactNode }) {
  useEffect(() => {
    useModalLayerStore.getState().mounted();
    return () => {
      useModalLayerStore.getState().unmounted();
    };
  }, []);
  return children;
}
