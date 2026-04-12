import React from 'react';
import {
  getProviderAbbreviation,
  getProviderColor,
  getProviderConfig,
} from '../../utils/provider-helpers';

interface SupporterOrbsProps {
  supporters: (string | number)[];
  citationSourceOrder?: Record<string | number, string>;
  size?: 'small' | 'large';
}

function getProviderFromSupporter(
  s: string | number,
  citationSourceOrder?: Record<string | number, string>
) {
  if (typeof s === 'string') {
    const config = getProviderConfig(s);
    if (config) return config;
  }
  if (
    citationSourceOrder &&
    (typeof s === 'number' || (typeof s === 'string' && !isNaN(Number(s))))
  ) {
    const providerId = citationSourceOrder[Number(s)];
    if (providerId) return getProviderConfig(providerId) || null;
  }
  return null;
}

export const SupporterOrbs: React.FC<SupporterOrbsProps> = ({
  supporters,
  citationSourceOrder,
  size = 'large',
}) => {
  const orbSize = size === 'large' ? 40 : 28;
  const fontSize = size === 'large' ? 11 : 9;

  return (
    <div className="flex gap-2 flex-wrap">
      {supporters.map((s, idx) => {
        const provider = getProviderFromSupporter(s, citationSourceOrder);
        const color = getProviderColor(provider?.id || 'default');
        const name = provider?.name || (s != null ? `Model ${s}` : 'Model');
        const abbrev = provider?.id
          ? getProviderAbbreviation(provider.id)
          : s != null
            ? `M${s}`
            : 'M';

        return (
          <div
            key={idx}
            className="rounded-full flex items-center justify-center font-semibold text-white border-2"
            style={{
              width: orbSize,
              height: orbSize,
              fontSize,
              backgroundColor: `${color}33`,
              borderColor: `${color}88`,
              boxShadow: `0 0 8px ${color}44`,
            }}
            title={name}
          >
            {abbrev}
          </div>
        );
      })}
    </div>
  );
};
