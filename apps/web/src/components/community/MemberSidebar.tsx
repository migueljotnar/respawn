import type { ChatMemberDto } from "../../lib/chat-api.js";
import { RoleIcon, roleAccentText, roleDisplayOrder } from "../../lib/role-badges.js";

interface MemberSidebarProps {
  className: string;
  members: ChatMemberDto[];
  onlineUserIds: Set<string>;
  membersError?: string | null;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function MemberRow({
  member,
  online,
}: {
  member: ChatMemberDto;
  online: boolean;
}) {
  const displayName = member.displayName ?? member.username;

  return (
    <li className="group flex min-h-12 items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
      <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-respawn-purple/10 text-[11px] font-black text-respawn-ice">
        {getInitials(displayName)}
        <span
          role="img"
          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-respawn-panel ${online ? "bg-respawn-neon" : "bg-slate-500"}`}
          aria-label={online ? "online" : "offline"}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-200 group-hover:text-respawn-ice">
            {displayName}
          </p>
          {member.role !== "NOVATO" && member.role !== "PLAYER" ? (
            <span className={roleAccentText[member.role]} aria-label={member.role}>
              <RoleIcon role={member.role} />
            </span>
          ) : null}
        </div>
        <p className="truncate text-[11px] text-slate-400">@{member.username}</p>
      </div>
    </li>
  );
}

export function MemberSidebar({
  className,
  members,
  onlineUserIds,
  membersError,
}: MemberSidebarProps) {
  return (
    <aside
      aria-label="Membros da comunidade"
      className={`${className} min-h-0 w-full min-w-0 flex-col border-l border-white/[0.07] bg-respawn-panel`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div>
          <h2 className="text-sm font-bold text-respawn-ice">Membros</h2>
          <p className="mt-0.5 text-[10px] uppercase tracking-digital text-slate-400">
            {onlineUserIds.size} online
          </p>
        </div>
        <span className="rounded-full border border-respawn-neon/20 bg-respawn-neon/[0.06] px-2 py-1 text-[10px] font-extrabold text-respawn-neon">
          {members.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {membersError && members.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-red-300">{membersError}</p>
        ) : members.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-slate-400">
            Nenhum outro membro por aqui ainda.
          </p>
        ) : (
          roleDisplayOrder.map((role) => {
            const roleMembers = members.filter((member) => member.role === role);

            if (roleMembers.length === 0) {
              return null;
            }

            return (
              <section key={role} aria-labelledby={`role-${role.toLowerCase()}`} className="mb-5">
                <h3
                  id={`role-${role.toLowerCase()}`}
                  className={`mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-extrabold uppercase tracking-digital ${roleAccentText[role]}`}
                >
                  <RoleIcon role={role} />
                  {role} — {roleMembers.length}
                </h3>
                <ul className="space-y-0.5" role="list">
                  {roleMembers.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      online={onlineUserIds.has(member.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] p-3">
        <div className="rounded-xl border border-respawn-purple/20 bg-respawn-purple/[0.06] p-3">
          <p className="text-xs font-bold text-respawn-ice">Ponto de encontro</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            Cargos e permissões completos chegam na Fase 5.
          </p>
        </div>
      </div>
    </aside>
  );
}
