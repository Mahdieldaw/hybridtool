import { forwardRef } from 'react';
import type { EditorialThread } from '../../shared/types';
import type { PassageResolver, ResolvedItem } from '../hooks/reading/usePassageResolver';
import { PassageBlock } from './PassageBlock';
import { ConflictPair } from './ConflictPair';
import { ContextCollapse } from './ContextCollapse';

interface ThreadSectionProps {
  thread: EditorialThread;
  resolver: PassageResolver;
  threadNumber: number;
}

type RoleCategory = 'anchor' | 'support' | 'reframe' | 'alternative' | 'context';

interface ResolvedThreadItem {
  resolved: ResolvedItem;
  role: RoleCategory;
  itemId: string;
}

export const ThreadSection = forwardRef<HTMLElement, ThreadSectionProps>(
  ({ thread, resolver, threadNumber }, ref) => {
    // Resolve all items
    const resolvedItems: ResolvedThreadItem[] = [];
    for (const item of thread.items) {
      const resolved = resolver.resolve(item.id);
      if (!resolved) continue;
      resolvedItems.push({ resolved, role: item.role, itemId: item.id });
    }

    // Group by role
    const anchors = resolvedItems.filter((i) => i.role === 'anchor');
    const supports = resolvedItems.filter((i) => i.role === 'support');
    const reframes = resolvedItems.filter((i) => i.role === 'reframe');
    const alternatives = resolvedItems.filter((i) => i.role === 'alternative');
    const contexts = resolvedItems.filter((i) => i.role === 'context');

    // Check for conflict pairs (anchor + alternative from same conflict cluster)
    const conflictPairs: Array<{ anchor: ResolvedThreadItem; alternative: ResolvedThreadItem }> =
      [];
    const usedAlternatives = new Set<string>();

    for (const anchor of anchors) {
      if (anchor.resolved.kind !== 'passage') continue;
      for (const alt of alternatives) {
        if (alt.resolved.kind !== 'passage') continue;
        if (usedAlternatives.has(alt.itemId)) continue;
        if (
          anchor.resolved.conflictClusterIndex !== null &&
          anchor.resolved.conflictClusterIndex === alt.resolved.conflictClusterIndex
        ) {
          conflictPairs.push({ anchor, alternative: alt });
          usedAlternatives.add(alt.itemId);
          break;
        }
      }
    }

    const standaloneAlternatives = alternatives.filter((a) => !usedAlternatives.has(a.itemId));

    return (
      <section ref={ref} className="mb-16" id={`thread-${thread.id}`}>
        {/* Thread header */}
        <div className="px-6 mb-4">
          <div className="flex items-center gap-2">
            {thread.start_here && (
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
            )}
            <h2 className="text-lg font-semibold text-text-primary">
              {threadNumber}. {thread.label}
            </h2>
          </div>
          <p className="text-sm text-text-muted mt-1">{thread.why_care}</p>
        </div>

        {/* Anchors first */}
        <div className="flex flex-col gap-4 px-6">
          {anchors.map((item) => (
            <PassageBlock key={item.itemId} resolved={item.resolved} role="anchor" />
          ))}
        </div>

        {/* Support */}
        {supports.length > 0 && (
          <div className="flex flex-col gap-3 px-6 mt-4">
            {supports.map((item) => (
              <PassageBlock key={item.itemId} resolved={item.resolved} role="support" />
            ))}
          </div>
        )}

        {/* Conflict pairs (side-by-side) */}
        {conflictPairs.length > 0 && (
          <div className="flex flex-col gap-4 px-6 mt-4">
            {conflictPairs.map((pair, i) => (
              <ConflictPair key={i} anchor={pair.anchor} alternative={pair.alternative} />
            ))}
          </div>
        )}

        {/* Reframes + standalone alternatives */}
        {(reframes.length > 0 || standaloneAlternatives.length > 0) && (
          <div className="flex flex-col gap-3 px-6 mt-4">
            {reframes.map((item) => (
              <PassageBlock key={item.itemId} resolved={item.resolved} role="reframe" />
            ))}
            {standaloneAlternatives.map((item) => (
              <PassageBlock key={item.itemId} resolved={item.resolved} role="alternative" />
            ))}
          </div>
        )}

        {/* Context (collapsed) */}
        {contexts.length > 0 && (
          <div className="px-6 mt-3">
            <ContextCollapse items={contexts} />
          </div>
        )}
      </section>
    );
  }
);

ThreadSection.displayName = 'ThreadSection';
