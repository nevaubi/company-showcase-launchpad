import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** Restore view preferences after hydration; never share research content across users. */
export function useSessionState<T>(key: string, initial: T, validate?: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const initialRef = useRef(initial);
  const validateRef = useRef(validate);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      const parsed: unknown = saved ? JSON.parse(saved) : initialRef.current;
      const validType = parsed !== null && typeof parsed === typeof initialRef.current && Array.isArray(parsed) === Array.isArray(initialRef.current);
      setValue(validType && (!validateRef.current || validateRef.current(parsed)) ? parsed as T : initialRef.current);
    } catch { setValue(initialRef.current); }
    setReadyKey(key);
  }, [key]);
  useEffect(() => {
    if (readyKey === key) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage unavailable. */ }
    }
  }, [key, value, readyKey]);
  return [value, setValue];
}