import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import type { CodeEditorProps } from "./CodeEditor.js";

/**
 * The CodeMirror 6 half of `CodeEditor`, split out so `lazy` can load it on demand.
 *
 * CodeMirror owns its document; React owns when it is replaced. The view is built
 * once per language and read-only setting, and `value` is pushed in only when it
 * differs from the document — so typing never round-trips through React state and
 * the cursor never jumps, while a reset to the starter still lands.
 */
export default function CodeEditorImpl({
  value,
  onChange,
  language,
  label,
  readOnly = false,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Read through a ref so a new callback identity does not rebuild the editor and
  // throw away the undo history.
  const changed = useRef(onChange);

  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (host.current === null) return;

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        // The value at mount; later values arrive through the effect below.
        doc: value,
        extensions: [
          basicSetup,
          language === "python" ? python() : javascript({ typescript: language === "typescript" }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
    // `value` is deliberately absent: it seeds the document, and replacing it is the
    // next effect's job. Rebuilding on every keystroke would reset the cursor.
  }, [language, readOnly, label]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null) return;

    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="mf-code-editor__surface" />;
}
