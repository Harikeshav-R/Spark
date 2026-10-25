import type { UUID } from "../../contracts/index.js";

const GRACE_PERIOD_MS = 30_000;

interface StudentPresenceEntry {
  sockets: Set<string>;
  graceTimer?: NodeJS.Timeout;
}

export class PresenceTracker {
  private readonly lectures = new Map<UUID, Map<UUID, StudentPresenceEntry>>();
  private disposed = false;

  join(lectureId: UUID, studentId: UUID, socketId: string): void {
    if (this.disposed) return;

    let studentMap = this.lectures.get(lectureId);
    if (!studentMap) {
      studentMap = new Map();
      this.lectures.set(lectureId, studentMap);
    }

    let entry = studentMap.get(studentId);
    if (!entry) {
      entry = { sockets: new Set() };
      studentMap.set(studentId, entry);
    }

    if (entry.graceTimer) {
      clearTimeout(entry.graceTimer);
      entry.graceTimer = undefined;
    }

    entry.sockets.add(socketId);
  }

  leave(lectureId: UUID, studentId: UUID, socketId: string): void {
    if (this.disposed) return;

    const studentMap = this.lectures.get(lectureId);
    if (!studentMap) return;

    const entry = studentMap.get(studentId);
    if (!entry) return;

    if (!entry.sockets.has(socketId)) return;
    entry.sockets.delete(socketId);

    if (entry.sockets.size === 0) {
      if (entry.graceTimer) {
        clearTimeout(entry.graceTimer);
        entry.graceTimer = undefined;
      }
      studentMap.delete(studentId);
      if (studentMap.size === 0) {
        this.lectures.delete(lectureId);
      }
    }
  }

  disconnect(lectureId: UUID, studentId: UUID, socketId: string): void {
    if (this.disposed) return;

    const studentMap = this.lectures.get(lectureId);
    if (!studentMap) return;

    const entry = studentMap.get(studentId);
    if (!entry) return;

    if (!entry.sockets.has(socketId)) return;
    entry.sockets.delete(socketId);

    if (entry.sockets.size === 0) {
      if (!entry.graceTimer) {
        const timer = setTimeout(() => {
          this.handleGraceExpiry(lectureId, studentId, timer);
        }, GRACE_PERIOD_MS);
        if (typeof timer.unref === "function") {
          timer.unref();
        }
        entry.graceTimer = timer;
      }
    }
  }

  private handleGraceExpiry(lectureId: UUID, studentId: UUID, timer: NodeJS.Timeout): void {
    if (this.disposed) return;

    const studentMap = this.lectures.get(lectureId);
    if (!studentMap) return;

    const entry = studentMap.get(studentId);
    if (!entry || entry.graceTimer !== timer) return;

    if (entry.sockets.size === 0) {
      studentMap.delete(studentId);
      if (studentMap.size === 0) {
        this.lectures.delete(lectureId);
      }
    }
  }

  getAttendingStudentIds(lectureId: UUID): UUID[] {
    if (this.disposed) return [];

    const studentMap = this.lectures.get(lectureId);
    if (!studentMap) return [];

    return Array.from(studentMap.keys());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const studentMap of this.lectures.values()) {
      for (const entry of studentMap.values()) {
        if (entry.graceTimer) {
          clearTimeout(entry.graceTimer);
          entry.graceTimer = undefined;
        }
      }
      studentMap.clear();
    }
    this.lectures.clear();
  }
}
