// ═══════════════════════════════════════════════════════════════════════════
// SEMANTIC MAPPER OUTPUT CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

import { Stance } from '../shadow';

// ═══════════════════════════════════════════════════════════════════════════
// GATE TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conditional Gate (Tier 0)
 * "If/when X" - a condition that determines whether this claim applies
 */
export interface ConditionalGate {
    id: string;                    // "cg_0", "cg_1"
    condition: string;             // The condition text
    question: string;              // Canonical question form (e.g., "Does this system expose a web API?")
    sourceStatementIds: string[];  // Provenance
}

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONSHIP TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conflict Edge
 * This claim conflicts/trades-off with the target claim
 */
export interface ConflictEdge {
    claimId: string;
    question: string;              // Canonical question form (e.g., "Which matters more: lower latency or greater flexibility?")
    sourceStatementIds: string[];  // Provenance (REQUIRED)
    nature?: 'optimization' | 'mutual_exclusion' | 'resource_competition';
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM TYPE
// ═══════════════════════════════════════════════════════════════════════════

export interface Claim {
    id: string;                    // "c_0", "c_1"

    // Human-legible abstraction
    label: string;                 // Short canonical form (required)
    description?: string;          // Optional clarification (non-authoritative)

    // Classification
    stance: Stance;                // Inherited from dominant source statements

    // Gating (Tier structure)
    gates: {
        conditionals: ConditionalGate[];   // Tier 0
    };

    // Relationships (minimal, provenance-required)
    enables?: string[];            // Claim IDs this enables (beyond supports)
    conflicts?: ConflictEdge[];    // Conflicts with provenance (REQUIRED)

    // Provenance (non-negotiable)
    sourceStatementIds: string[];  // ShadowStatement.id[]
}

// ═══════════════════════════════════════════════════════════════════════════
// MAPPER OUTPUT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Semantic Mapper produces claims only.
 * No excluded (Shadow Delta handles audit).
 * No ghosts (Traversal/Concierge handles gaps).
 */
export interface SemanticMapperOutput {
    claims: Claim[];
}
