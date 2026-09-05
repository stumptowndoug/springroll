import type { RunTaskResult } from "./contracts.ts";
import { publicFailureMessage } from "./failures.ts";

/** A failed run can still have a durable, explicitly incomplete final report. */
export class PartialRunFailure extends Error {
  override readonly name = "PartialRunFailure";
  constructor(
    cause: unknown,
    readonly result: RunTaskResult["result"],
  ) {
    super(publicFailureMessage(cause), { cause });
  }
}
