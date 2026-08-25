import type { EventEmitter } from "node:events";

/**
 * Nome de evento compartilhado entre o módulo de auth (que revoga sessões
 * no logout) e o gateway de chat (que precisa desconectar imediatamente
 * qualquer socket ligado à sessão revogada, em vez de esperar o próximo
 * evento ou o timer de expiração). Os dois lados recebem a MESMA instância
 * de EventEmitter — ver server.ts.
 */
export const SESSION_REVOKED_EVENT = "session:revoked";

export interface SessionRevokedPayload {
  sessionId: string;
}

interface SessionCoordinationState {
  readonly revokedSessionIds: Map<string, number>;
  readonly revocationPendingCounts: Map<string, number>;
  readonly tailsBySessionId: Map<string, Promise<void>>;
  lastTombstonePruneAt: number;
}

// O JWT mais longo aceito pela aplicação dura 30 dias. Uma tombstone por 31
// dias cobre qualquer snapshot de verifySession ainda em trânsito sem reter
// IDs revogados para sempre durante a vida do processo.
const REVOCATION_TOMBSTONE_TTL_MS = 31 * 24 * 60 * 60 * 1_000;
const TOMBSTONE_PRUNE_INTERVAL_MS = 60 * 1_000;

/**
 * O EventEmitter já é a identidade compartilhada entre auth e WebSocket no
 * processo. O WeakMap associa a essa identidade o estado de coordenação sem
 * mudar o contrato dos chamadores nem manter emitters encerrados vivos.
 */
const coordinationByEmitter = new WeakMap<EventEmitter, SessionCoordinationState>();

function coordinationState(sessionEvents: EventEmitter): SessionCoordinationState {
  const existing = coordinationByEmitter.get(sessionEvents);

  if (existing) {
    return existing;
  }

  const created: SessionCoordinationState = {
    revokedSessionIds: new Map<string, number>(),
    revocationPendingCounts: new Map<string, number>(),
    tailsBySessionId: new Map<string, Promise<void>>(),
    lastTombstonePruneAt: 0,
  };
  coordinationByEmitter.set(sessionEvents, created);
  return created;
}

function pruneExpiredTombstones(
  state: SessionCoordinationState,
  now = Date.now(),
): void {
  if (now - state.lastTombstonePruneAt < TOMBSTONE_PRUNE_INTERVAL_MS) {
    return;
  }

  for (const [sessionId, expiresAt] of state.revokedSessionIds) {
    if (expiresAt <= now) {
      state.revokedSessionIds.delete(sessionId);
    }
  }

  state.lastTombstonePruneAt = now;
}

/**
 * Serializa operações sensíveis da mesma sessão no processo. Em particular,
 * message:send mantém esta exclusão até o commit e o logout a mantém desde a
 * checagem até a revogação + emissão do evento. Assim existe uma ordem total:
 * a mensagem termina antes do logout, ou o logout vence e a mensagem observa
 * a sessão revogada antes de começar a persistência.
 */
export async function withSessionLock<T>(
  sessionEvents: EventEmitter,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const state = coordinationState(sessionEvents);
  const previous = state.tailsBySessionId.get(sessionId) ?? Promise.resolve();
  const operationPromise = previous.catch(() => undefined).then(operation);
  const tail = operationPromise.then(
    () => undefined,
    () => undefined,
  );

  state.tailsBySessionId.set(sessionId, tail);

  try {
    return await operationPromise;
  } finally {
    if (state.tailsBySessionId.get(sessionId) === tail) {
      state.tailsBySessionId.delete(sessionId);
    }
  }
}

export function markSessionRevoked(sessionEvents: EventEmitter, sessionId: string): void {
  const state = coordinationState(sessionEvents);
  const now = Date.now();
  pruneExpiredTombstones(state, now);
  state.revokedSessionIds.set(sessionId, now + REVOCATION_TOMBSTONE_TTL_MS);
  state.revocationPendingCounts.delete(sessionId);
}

export function isSessionRevoked(sessionEvents: EventEmitter, sessionId: string): boolean {
  const state = coordinationState(sessionEvents);
  const now = Date.now();
  pruneExpiredTombstones(state, now);
  const expiresAt = state.revokedSessionIds.get(sessionId);

  if (expiresAt === undefined) {
    return false;
  }

  if (expiresAt <= now) {
    state.revokedSessionIds.delete(sessionId);
    return false;
  }

  return true;
}

/**
 * Sinaliza a intenção de revogar antes de aguardar o lock. Operações que já
 * possuem o lock podem concluir como anteriores à revogação; ações novas ou
 * ainda enfileiradas veem este estado e são recusadas sem I/O adicional.
 * O contador mantém correção quando dois logouts concorrentes disputam a
 * mesma sessão e somente um deles falha/cancela.
 */
export function beginSessionRevocation(
  sessionEvents: EventEmitter,
  sessionId: string,
): void {
  const state = coordinationState(sessionEvents);
  state.revocationPendingCounts.set(
    sessionId,
    (state.revocationPendingCounts.get(sessionId) ?? 0) + 1,
  );
}

export function cancelSessionRevocation(
  sessionEvents: EventEmitter,
  sessionId: string,
): void {
  const state = coordinationState(sessionEvents);
  const count = state.revocationPendingCounts.get(sessionId);

  if (count === undefined) {
    return;
  }

  if (count <= 1) {
    state.revocationPendingCounts.delete(sessionId);
    return;
  }

  state.revocationPendingCounts.set(sessionId, count - 1);
}

export function isSessionRevocationPending(
  sessionEvents: EventEmitter,
  sessionId: string,
): boolean {
  return (coordinationState(sessionEvents).revocationPendingCounts.get(sessionId) ?? 0) > 0;
}
