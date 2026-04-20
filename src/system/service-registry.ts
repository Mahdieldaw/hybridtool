/**
 * ServiceRegistry (Singleton)
 *
 * Central repository for global service instances in the Service Worker.
 * Replaces global variables and self objects to allow clean dependency access
 * throughout the application without circular imports or global pollution.
 */
export class ServiceRegistry {
  private static instance: ServiceRegistry | undefined;

  public services: Map<string, unknown>;

  constructor() {
    this.services = new Map();
  }

  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  register(name: string, instance: unknown): void {
    if (!name || !instance) {
      throw new Error(`[ServiceRegistry] Invalid registration: name=${name}`);
    }
    this.services.set(name, instance);
    console.log(`[ServiceRegistry] Registered service: ${name}`);
  }

  get(name: string): unknown {
    return this.services.get(name);
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  unregister(name: string): boolean {
    return this.services.delete(name);
  }

  // Quick accessors for common services
  get sessionManager(): unknown {
    return this.get('sessionManager');
  }
  get persistenceLayer(): unknown {
    return this.get('persistenceLayer');
  }
  get orchestrator(): unknown {
    return this.get('orchestrator');
  }
  get authManager(): unknown {
    return this.get('authManager');
  }
}

export const services: ServiceRegistry = ServiceRegistry.getInstance();
