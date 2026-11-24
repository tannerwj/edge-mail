import { Bold, Italic } from "lucide-react";
import { getSchema, Node } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, Plugin, TextSelection } from "@tiptap/pm/state";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap } from "@tiptap/pm/commands";
import { Decoration, DecorationSet, EditorView } from "@tiptap/pm/view";
import { Component, createRef } from "react";
import { textParts } from "../src/rich-text";

const documentNode = Node.create({ name: "doc", topNode: true, content: "body" });
const bodyNode = Node.create({
  name: "body",
  group: "block",
  content: "text*",
  code: true,
  renderHTML: () => ["div", 0],
});
const textNode = Node.create({ name: "text", group: "inline" });
function wrap(view: EditorView, marker: string) {
  const { from, to } = view.state.selection;
  const selected = view.state.doc.textBetween(from, to) || "text";
  const tr = view.state.tr.insertText(marker + selected + marker, from, to);
  tr.setSelection(
    TextSelection.create(tr.doc, from + marker.length, from + marker.length + selected.length),
  );
  view.dispatch(tr);
  view.focus();
  return true;
}
const schema = getSchema([documentNode, bodyNode, textNode]);
const newline = (state: EditorState, dispatch?: EditorView["dispatch"]) => {
  dispatch?.(state.tr.insertText("\n"));
  return true;
};
const shortcuts = keymap({
  End(state, dispatch) {
    const { $head } = state.selection;
    const newlineAt = $head.parent.textContent.indexOf("\n", $head.parentOffset);
    const end = newlineAt < 0 ? $head.end() : $head.start() + newlineAt;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, end)).scrollIntoView());
    return true;
  },
  Enter: newline,
  "Shift-Enter": newline,
  "Mod-b": (_state, _dispatch, view) => !!view && wrap(view, "**"),
  "Mod-i": (_state, _dispatch, view) => !!view && wrap(view, "_"),
  "Mod-z": undo,
  "Mod-Shift-z": redo,
});
const formatting = new Plugin({
  filterTransaction: (tr) => !tr.docChanged || tr.doc.content.size <= 130002,
  props: {
    decorations(state) {
      const spans = textParts(state.doc.textContent).flatMap((part) => {
        if (part.style === "text") return [];
        const start = 1 + part.start + (part.style === "strong" ? 2 : 1);
        return [Decoration.inline(start, start + part.text.length, { nodeName: part.style })];
      });
      return DecorationSet.create(state.doc, spans);
    },
    handlePaste(view, event) {
      const plain = event.clipboardData?.getData("text/plain");
      if (plain) view.dispatch(view.state.tr.insertText(plain.replace(/\r\n?/g, "\n")));
      return true;
    },
    handleDrop: () => true,
  },
});
function documentFor(value: string) {
  return schema.node("doc", null, [
    schema.node("body", null, value ? schema.text(value) : undefined),
  ]);
}
type Props = { value: string; change: (value: string) => void };
export default class RichEditor extends Component<Props> {
  private host = createRef<HTMLDivElement>();
  private editor?: EditorView;
  componentDidMount() {
    if (!this.host.current) return;
    this.editor = new EditorView(this.host.current, {
      state: EditorState.create({
        doc: documentFor(this.props.value),
        plugins: [shortcuts, keymap(baseKeymap), history(), formatting],
      }),
      attributes: {
        role: "textbox",
        "aria-label": "Message",
        "aria-multiline": "true",
        class: "rich-input",
      },
      dispatchTransaction: (tr) => {
        const view = this.editor;
        if (!view) return;
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) this.props.change(next.doc.textContent);
      },
    });
  }
  componentDidUpdate() {
    const view = this.editor;
    if (view && this.props.value !== view.state.doc.textContent) {
      const tr = view.state.tr.replaceWith(
        0,
        view.state.doc.content.size,
        documentFor(this.props.value).content,
      );
      view.updateState(view.state.apply(tr));
    }
  }
  componentWillUnmount() {
    this.editor?.destroy();
  }
  render() {
    return (
      <>
        <div className="my-2 flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1"
            onClick={() => this.editor && wrap(this.editor, "**")}
          >
            <Bold size={14} aria-hidden="true" /> Bold
          </button>{" "}
          <button
            type="button"
            className="inline-flex items-center gap-1"
            onClick={() => this.editor && wrap(this.editor, "_")}
          >
            <Italic size={14} aria-hidden="true" /> Italic
          </button>
        </div>
        <div>Message</div>
        <div ref={this.host} />
      </>
    );
  }
}
