export interface SpikeEnvironment {
  RIVETKIT_STORAGE_PATH?: string;
  RIVET_ENDPOINT?: string;
  RIVET_RUN_ENGINE_HOST?: string;
  RIVET_RUN_ENGINE_PORT?: string;
}

export function configureSpikeEnvironment(
  environment: SpikeEnvironment,
  storagePath: string,
): SpikeEnvironment {
  environment.RIVETKIT_STORAGE_PATH ??= storagePath;
  environment.RIVET_RUN_ENGINE_HOST ??= "127.0.0.1";
  environment.RIVET_RUN_ENGINE_PORT ??= "16420";
  environment.RIVET_ENDPOINT ??= `http://${environment.RIVET_RUN_ENGINE_HOST}:${environment.RIVET_RUN_ENGINE_PORT}`;
  return environment;
}
