import {
  Crown,
  Gamepad2,
  ShieldCheck,
  Sparkles,
  Star,
  Swords,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import type { MemberRole } from "../data/community-mocks.js";

export const roleDisplayOrder: MemberRole[] = [
  "ADMIN",
  "MOD",
  "ELITE",
  "MVP",
  "VETERAN",
  "SQUADMATE",
  "PLAYER",
  "NOVATO",
];

export const roleBadgeStyles: Record<MemberRole, string> = {
  NOVATO: "border-slate-500/50 bg-slate-500/10 text-slate-300",
  PLAYER: "border-slate-500/50 bg-slate-500/10 text-slate-300",
  SQUADMATE: "border-sky-400/30 bg-sky-400/[0.08] text-sky-200",
  VETERAN: "border-respawn-purple/30 bg-respawn-purple/[0.08] text-purple-200",
  MVP: "border-amber-400/30 bg-amber-400/[0.08] text-amber-200",
  ELITE: "border-respawn-neon/25 bg-respawn-neon/[0.07] text-respawn-neon",
  MOD: "border-respawn-neon/25 bg-respawn-neon/[0.07] text-respawn-neon",
  ADMIN: "border-rose-400/30 bg-rose-400/[0.08] text-rose-200",
};

export const roleAccentText: Record<MemberRole, string> = {
  NOVATO: "text-slate-300",
  PLAYER: "text-slate-300",
  SQUADMATE: "text-sky-300",
  VETERAN: "text-purple-300",
  MVP: "text-amber-300",
  ELITE: "text-respawn-neon",
  MOD: "text-respawn-neon",
  ADMIN: "text-rose-300",
};

const roleIcons: Record<MemberRole, LucideIcon> = {
  NOVATO: Gamepad2,
  PLAYER: Gamepad2,
  SQUADMATE: Swords,
  VETERAN: Trophy,
  MVP: Star,
  ELITE: Sparkles,
  MOD: ShieldCheck,
  ADMIN: Crown,
};

export function RoleIcon({
  role,
  className = "h-3.5 w-3.5",
}: {
  role: MemberRole;
  className?: string;
}) {
  const Icon = roleIcons[role];
  return <Icon className={className} aria-hidden="true" />;
}
