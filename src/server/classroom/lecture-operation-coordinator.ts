import type { UUID } from "../../contracts/common.js";

export class LectureOperationCoordinator {
  private readonly gates = new Map<UUID, Promise<void>>();

  async runExclusive<T>(lectureId: UUID, operation: () => Promise<T>): Promise<T> {
    const previousGate = this.gates.get(lectureId) ?? Promise.resolve();
    const { promise: currentGate, resolve: releaseGate } =
      Promise.withResolvers<void>();

    this.gates.set(lectureId, currentGate);

    try {
      await previousGate.catch(() => {});
      return await operation();
    } finally {
      releaseGate();
      if (this.gates.get(lectureId) === currentGate) {
        this.gates.delete(lectureId);
      }
    }
  }
}
