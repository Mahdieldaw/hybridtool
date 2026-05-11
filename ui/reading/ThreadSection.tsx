import { forwardRef } from 'react';
import type { EditorialThread } from '../../shared/types';
import type { PassageResolver, ResolvedItem } from '../hooks/reading/usePassageResolver';
import { PassageBlock } from './PassageBlock';

interface ThreadSectionProps {
  thread: EditorialThread;
  resolver: PassageResolver;
  threadNumber: number;
}

type RoleCategory = 'anchor' | 'development' | 'alternative';

interface ResolvedThreadItem {
  resolved: ResolvedItem;
  role: RoleCategory;
  itemId: string;
}

export const ThreadSection = forwardRef<HTMLElement, ThreadSectionProps>(
  ({ thread, resolver, threadNumber }, ref) => {
    const resolvedItems: ResolvedThreadItem[] = [];
    for (const item of thread.items) {
      const resolved = resolver.resolve(item.id);
      if (!resolved) continue;
      resolvedItems.push({ resolved, role: item.role, itemId: item.id });
    }

    const anchors = resolvedItems.filter((i) => i.role === 'anchor');
    const developments = resolvedItems.filter((i) => i.role === 'development');
    const alternatives = resolvedItems.filter((i) => i.role === 'alternative');

    return (
      <section ref={ref} className="mb-16" id={`thread-${thread.id}`}>
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

        <div className="flex flex-col gap-4 px-6">
          {anchors.map((item) => (
            <PassageBlock key={item.itemId} resolved={item.resolved} role="anchor" />
          ))}
        </div>

        {developments.length > 0 && (
          <div className="flex flex-col gap-3 px-6 mt-4">
            {developments.map((item) => (
              <PassageBlock key={item.itemId} resolved={item.resolved} role="development" />
            ))}
          </div>
        )}

        {alternatives.length > 0 && (
          <div className="flex flex-col gap-3 px-6 mt-4">
            {alternatives.map((item) => (
              <PassageBlock key={item.itemId} resolved={item.resolved} role="alternative" />
            ))}
          </div>
        )}
      </section>
    );
  }
);

ThreadSection.displayName = 'ThreadSection';
