import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface MobileDrawerProps {
  title: string;
  side: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileDrawer({
  title,
  side,
  onClose,
  children,
}: MobileDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        onClick={onClose}
        aria-label={`Fechar ${title}`}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-drawer-title"
        className={`absolute inset-y-0 flex max-w-[calc(100vw-16px)] shadow-panel ${
          side === "left" ? "left-0" : "right-0"
        }`}
      >
        <h2 id="mobile-drawer-title" className="sr-only">
          {title}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={`Fechar ${title}`}
          className={`absolute top-2.5 z-20 grid h-11 w-11 place-items-center rounded-xl border border-slate-500 bg-respawn-base/95 text-slate-200 shadow-lg outline-none transition-colors hover:text-respawn-neon focus-visible:ring-2 focus-visible:ring-respawn-neon ${
            side === "left" ? "right-3" : "left-3"
          }`}
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
