import React from "react";
import { getProviderColor, getProviderConfig } from "../../utils/provider-helpers";

interface SupporterOrbsProps {
  supporters: (string | number)[];
  citationSourceOrder?: Record<string | number, string>;
  size?: "small" | "large";
}

function getProviderFromSupporter(s: string | number, citationSourceOrder?: Record<string | number, string>) {
  if ((typeof s === "number" || !isNaN(Number(s))) && citationSourceOrder) {
    const providerId = citationSourceOrder[Number(s)];
    if (providerId) return getProviderConfig(providerId) || null;
  }
  if (typeof s === "string" && isNaN(Number(s))) {
    return getProviderConfig(s) || null;
  }
  return null;
}

function getInitials(name: string) {
  const words = name.split(/\s+/);
  if (words.length === 1) return name.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export const SupporterOrbs: React.FC<SupporterOrbsProps> = ({ supporters, citationSourceOrder, size = "large" }) => {
  const orbSize = size === "large" ? 40 : 28;
  const fontSize = size === "large" ? 11 : 9;

  return (
    <div className="flex gap-2 flex-wrap">
      {supporters.map((s, idx) => {
        const provider = getProviderFromSupporter(s, citationSourceOrder);
        const color = getProviderColor(provider?.id || "default");
        const name = provider?.name || `Model ${s}`;
        const initials = getInitials(name);

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
            {initials}
          </div>
        );
      })}
    </div>
  );
};
