import { dirname, join } from "node:path";

export interface LocalRivetEnvironment {
  [key: string]: string | undefined;
  RIVET_ENDPOINT?: string;
  RIVETKIT_STORAGE_PATH?: string;
  RIVET_RUN_ENGINE_HOST?: string;
  RIVET_RUN_ENGINE_PORT?: string;
}

export interface ConfiguredLocalRivetEnvironment extends LocalRivetEnvironment {
  RIVET_ENDPOINT: string;
  RIVETKIT_STORAGE_PATH: string;
  RIVET_RUN_ENGINE_HOST: string;
  RIVET_RUN_ENGINE_PORT: string;
}

export function configureLocalRivetEnvironment(
  environment: LocalRivetEnvironment,
  databasePath: string,
): ConfiguredLocalRivetEnvironment {
  environment.RIVETKIT_STORAGE_PATH ??= join(
    dirname(databasePath),
    "rivet-engine",
  );
  environment.RIVET_RUN_ENGINE_HOST ??= "127.0.0.1";
  // 16421 was used before engine storage was isolated. Using a fresh port
  // prevents an orphaned pre-isolation engine from being silently reused.
  environment.RIVET_RUN_ENGINE_PORT ??= "16441";
  environment.RIVET_ENDPOINT ??= `http://${environment.RIVET_RUN_ENGINE_HOST}:${environment.RIVET_RUN_ENGINE_PORT}`;
  return environment as ConfiguredLocalRivetEnvironment;
}
