import { useCallback, useEffect, useRef } from "react";
import { useEventListener } from "usehooks-ts";

type KeyCallback = (event: KeyboardEvent) => void;

export function useKey(key: string, callback: KeyCallback) {
  const callbackRef = useRef<KeyCallback>(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === key) {
        callbackRef.current(event);
      }
    },
    [key]
  );

  useEventListener("keydown", handleKeyDown);
}
