import { randomInt, randomUUID } from "node:crypto";
import type { IdGenerator, UUID } from "../../contracts/common";

const JOIN_CODE_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export class CryptoIdGenerator implements IdGenerator {
  generateId(): UUID {
    return randomUUID();
  }

  generateJoinCode(): string {
    let code = "";
    for (let i = 0; i < 8; i++) {
      const index = randomInt(36);
      code += JOIN_CODE_CHARSET[index];
    }
    return code;
  }
}
