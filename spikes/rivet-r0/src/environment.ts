import { join } from "node:path";
import { configureSpikeEnvironment } from "./environment-config.ts";

configureSpikeEnvironment(process.env, join(import.meta.dir, "..", ".data"));
