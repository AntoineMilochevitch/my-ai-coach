import type { DetailedHTMLProps, HTMLAttributes } from "react";

// Déclare <ion-icon> comme élément JSX valide (web component Ionicons).
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ion-icon": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        name?: string;
        size?: string;
      };
    }
  }
}

export {};
