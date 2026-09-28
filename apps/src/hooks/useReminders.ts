import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useHabitStore } from "../store/habitStore";
import { usePipStore } from "../store/pipStore";
import { reminderService } from "../services/reminderService";

/**
 * Keeps the reminder scheduler (which runs in Rust, so a minimised window's
 * throttled timers cannot delay it) told what the reader is doing, and hands
 * a clicked reminder's route to the app.
 *
 * `onActivate` receives "continue" (pick up the last book) or "open".
 */
export const useReminders = (bookOpen: boolean, onActivate: (route: string) => void) => {
  const sessionRunning = useHabitStore((state) => state.activeSession !== null);
  const pipMode = usePipStore((state) => state.mode);

  useEffect(() => {
    void reminderService.context(sessionRunning, bookOpen, pipMode).catch(() => undefined);
  }, [sessionRunning, bookOpen, pipMode]);

  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const drain = () => {
      void reminderService
        .takeActivation()
        .then((route) => {
          if (route && !disposed) {
            onActivateRef.current(route);
          }
        })
        .catch(() => undefined);
    };
    // A click that launched the app is waiting already; one that reaches the
    // running app arrives as an event.
    void listen("reminder-activation", drain)
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        drain();
      })
      .catch(drain);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
};
