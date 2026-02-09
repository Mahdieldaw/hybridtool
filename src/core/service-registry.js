// src/core/service-registry.js

/**
 * ServiceRegistry (Singleton)
 * 
 * Central repository for global service instances in the Service Worker.
 * Replaces global variables and self objects to allow clean dependency access
 * throughout the application without circular imports or global pollution.
 */
export class ServiceRegistry {
    static instance;

    constructor() {
        this.services = new Map();
    }

    static getInstance() {
        if (!ServiceRegistry.instance) {
            ServiceRegistry.instance = new ServiceRegistry();
        }
        return ServiceRegistry.instance;
    }

    register(name, instance) {
        if (!name || !instance) {
            throw new Error(`[ServiceRegistry] Invalid registration: name=${name}`);
        }
        this.services.set(name, instance);
        console.log(`[ServiceRegistry] Registered service: ${name}`);
    }

    get(name) {
        return this.services.get(name);
    }

    has(name) {
        return this.services.has(name);
    }

    unregister(name) {
        return this.services.delete(name);
    }

    // Quick accessors for common services
    get sessionManager() { return this.get('sessionManager'); }
    get persistenceLayer() { return this.get('persistenceLayer'); }
    get orchestrator() { return this.get('orchestrator'); }
    get authManager() { return this.get('authManager'); }
}

export const services = ServiceRegistry.getInstance();
