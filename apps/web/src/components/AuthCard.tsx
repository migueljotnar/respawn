import type { ReactNode } from "react";

interface AuthCardProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthCard({ eyebrow, title, description, children }: AuthCardProps) {
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-respawn-panel/95 p-5 shadow-panel backdrop-blur-xl sm:p-8">
      <div className="mb-7">
        <p className="mb-3 text-[11px] font-extrabold uppercase tracking-digital text-respawn-neon">
          {eyebrow}
        </p>
        <h1 className="font-display text-3xl leading-tight tracking-tight text-respawn-ice sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      </div>
      {children}
    </div>
  );
}
