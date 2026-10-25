import { Suspense, lazy } from "react";
import { closeStudy, useStudyStore } from "./studyStore";

// The quiz, the cards, Pip's sprite and their paper come only when Revise is opened: none of it is the Library's start.
const ReviseWords = lazy(() => import("../components/pip/arcade/quiz/ReviseWords").then((module) => ({ default: module.ReviseWords })));

/**
 * Where Revise opens, once for the app: from the Library's key, a book's
 * menu, or a book's highlights (study/studyStore.ts says which and on what).
 */
export const StudyOverlay = () => {
  const view = useStudyStore((state) => state.view);
  return view ? (
    <Suspense fallback={null}>
      <ReviseWords key={view.page === "cards" ? `cards:${view.bookId}` : "revise"} view={view} onClose={closeStudy} />
    </Suspense>
  ) : null;
};
