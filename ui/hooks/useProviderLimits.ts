import { useMemo } from 'react';
import { PROVIDER_LIMITS } from '../../shared/provider-limits';

export interface ProviderLimitCheck {
    isAllowed: boolean;
    maxChars: number;
    warnThreshold: number;
    currentLength: number;
    reason?: string;
}

export const useProviderLimits = (
    providerId: string | null,
    promptLength: number
): ProviderLimitCheck => {
    return useMemo(() => {
        if (!providerId) {
            return {
                isAllowed: true,
                maxChars: Infinity,
                warnThreshold: Infinity,
                currentLength: promptLength
            };
        }

        const config = PROVIDER_LIMITS[providerId as keyof typeof PROVIDER_LIMITS] || PROVIDER_LIMITS['chatgpt'];

        return {
            isAllowed: promptLength <= config.maxInputChars,
            maxChars: config.maxInputChars,
            warnThreshold: config.warnThreshold,
            currentLength: promptLength,
            reason: promptLength > config.maxInputChars
                ? `Exceeds input limit (${promptLength.toLocaleString()} / ${config.maxInputChars.toLocaleString()})`
                : undefined
        };
    }, [providerId, promptLength]);
};

export const getProviderLimitStatus = (providerId: string, length: number) => {
    const config = PROVIDER_LIMITS[providerId as keyof typeof PROVIDER_LIMITS] || PROVIDER_LIMITS['chatgpt'];
    return {
        isAllowed: length <= config.maxInputChars,
        limit: config.maxInputChars
    };
};
