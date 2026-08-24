import { CircleAlert } from "lucide-react";

interface StatusBannerProps {
  message: string | null;
}

export function StatusBanner({ message }: StatusBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-5 flex gap-3 rounded-xl border border-red-400/25 bg-red-400/10 p-3.5 text-sm leading-6 text-red-100"
    >
      <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
