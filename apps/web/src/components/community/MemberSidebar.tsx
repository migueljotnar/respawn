import { Gamepad2, ShieldCheck, Trophy } from "lucide-react";

import {
  communityMembers,
  memberRoleOrder,
  type CommunityMember,
  type MemberRole,
  type MemberStatus,
} from "../../data/community-mocks.js";

interface MemberSidebarProps {
  className: string;
}

const roleStyles: Record<MemberRole, string> = {
  MOD: "text-respawn-neon",
  VETERAN: "text-purple-300",
  PLAYER: "text-slate-300",
};

const statusStyles: Record<MemberStatus, string> = {
  online: "bg-respawn-neon",
  idle: "bg-amber-300",
  offline: "bg-slate-500",
};

const statusLabels: Record<MemberStatus, string> = {
  online: "online",
  idle: "ausente",
  offline: "offline",
};

function RoleIcon({ role }: { role: MemberRole }) {
  if (role === "MOD") return <ShieldCheck className="h-3.5 w-3.5" />;
  if (role === "VETERAN") return <Trophy className="h-3.5 w-3.5" />;
  return <Gamepad2 className="h-3.5 w-3.5" />;
}

function MemberRow({ member }: { member: CommunityMember }) {
  return (
    <li className="group flex min-h-12 items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
      <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-respawn-purple/10 text-[11px] font-black text-respawn-ice">
        {member.initials}
        <span
          role="img"
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-respawn-panel ${statusStyles[member.status]}`}
          aria-label={`Status demonstrativo: ${statusLabels[member.status]}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-200 group-hover:text-respawn-ice">
            {member.name}
          </p>
          {member.role !== "PLAYER" ? (
            <span className={roleStyles[member.role]} aria-label={member.role}>
              <RoleIcon role={member.role} />
            </span>
          ) : null}
        </div>
        <p className="truncate text-[11px] text-slate-400">{member.activity}</p>
      </div>
    </li>
  );
}

export function MemberSidebar({ className }: MemberSidebarProps) {
  return (
    <aside
      aria-label="Membros da comunidade"
      className={`${className} min-h-0 w-full min-w-0 flex-col border-l border-white/[0.07] bg-respawn-panel`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div>
          <h2 className="text-sm font-bold text-respawn-ice">Membros</h2>
          <p className="mt-0.5 text-[10px] uppercase tracking-digital text-slate-400">
            lista demonstrativa
          </p>
        </div>
        <span className="rounded-full border border-respawn-neon/20 bg-respawn-neon/[0.06] px-2 py-1 text-[10px] font-extrabold text-respawn-neon">
          {communityMembers.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {memberRoleOrder.map((role) => {
          const members = communityMembers.filter((member) => member.role === role);

          return (
            <section key={role} aria-labelledby={`role-${role.toLowerCase()}`} className="mb-5">
              <h3
                id={`role-${role.toLowerCase()}`}
                className={`mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-extrabold uppercase tracking-digital ${roleStyles[role]}`}
              >
                <RoleIcon role={role} />
                {role} — {members.length}
              </h3>
              <ul className="space-y-0.5" role="list">
                {members.map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] p-3">
        <div className="rounded-xl border border-respawn-purple/20 bg-respawn-purple/[0.06] p-3">
          <p className="text-xs font-bold text-respawn-ice">Ponto de encontro</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            Roles, presença e atividades nesta tela usam dados simulados.
          </p>
        </div>
      </div>
    </aside>
  );
}
