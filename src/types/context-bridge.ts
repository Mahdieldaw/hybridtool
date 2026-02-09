/**
 * Context Bridge Types - Simplified for Concierge/Singularity Flow
 * 
 * The context bridge packages essential information from the completed turn
 * to inform the next turn's batch responses.
 */

import { MapperArtifact } from "../../shared/contract";

/**
 * Singularity context passed to the next turn.
 * Contains the response, the brief used, and any narrative context.
 */
export interface SingularityContext {
  /** The singularity's response text from the last turn */
  response: string | null;
  /** The particular brief from the mapper that singularity used */
  brief: string | null;
  /** Any narrative context that was generated */
  narrative: string | null;
}

/**
 * Context Bridge - The package of information passed to the next turn's batch responses.
 * 
 * The bridge now focuses on three key elements:
 * 1. The query/narrative (what the user asked)
 * 2. The singularity response (the concierge's last output)
 * 3. The mapper brief (structural context used by singularity)
 */
export interface ContextBridge {
  /** The user's query/message */
  query: string;

  /** The mapper artifact/landscape from the completed turn */
  landscape: MapperArtifact | null;

  /** The turn ID this context was built from */
  turnId: string;

  /** Singularity context for the next turn's batch responses */
  singularityContext?: SingularityContext;

  /** The particular brief from the mapper that singularity used */
  mapperBrief?: string;
}

