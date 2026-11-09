import { randomBytes } from "node:crypto";

export function nid(prefix) {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}
