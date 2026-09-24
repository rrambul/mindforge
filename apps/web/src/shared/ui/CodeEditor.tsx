import { lazy, Suspense } from "react";
import "./styles/code-editor.css";

export type CodeEditorLanguage = "javascript" | "typescript" | "python";

export interface CodeEditorProps {
  /**
   * The document. Controlled in the one direction that matters: a new `value` that
   * differs from what the editor holds replaces it (a reset to the starter), and the
   * learner's own typing arrives through `onChange` without being written back.
   */
  readonly value: string;
  readonly onChange?: (value: string) => void;
  readonly language: CodeEditorLanguage;
  /** The accessible name of the editing surface. Already translated. */
  readonly label: string;
  readonly readOnly?: boolean;
}

/**
 * CodeMirror, loaded only where code is written.
 *
 * `lazy` because the editor is roughly as large as the rest of the lesson route put
 * together, and every other screen in the app would otherwise pay for it on first
 * load. The fallback is a plain block holding the same text, so the panel does not
 * jump when the editor arrives and the learner can read the starter while it does.
 */
const Editor = lazy(() => import("./code-editor-impl.js"));

export function CodeEditor(props: CodeEditorProps) {
  return (
    <div className="mf-code-editor">
      <Suspense fallback={<pre className="mf-code-editor__fallback">{props.value}</pre>}>
        <Editor {...props} />
      </Suspense>
    </div>
  );
}
