import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";
import { Component, createRef, type ReactNode } from "react";

type Props<T> = { rows: T[]; selected?: string; children: (row: T) => ReactNode };
export class ConversationList<T extends { id: string }> extends Component<Props<T>> {
  private viewport = createRef<HTMLDivElement>();
  private rowHeight = document.documentElement.dataset.theme === "compact" ? 60 : 92;
  private detach?: () => void;
  private options(rows: T[]) {
    return {
      count: rows.length,
      enabled: rows.length > 60,
      overscan: 5,
      getScrollElement: () => this.viewport.current,
      estimateSize: () => this.rowHeight,
      getItemKey: (i: number) => rows[i].id,
      observeElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
      onChange: () => this.forceUpdate(),
    };
  }
  private list = new Virtualizer<HTMLDivElement, HTMLDivElement>(this.options(this.props.rows));
  componentDidMount() {
    this.detach = this.list._didMount();
    this.list._willUpdate();
    this.revealSelection();
  }
  componentDidUpdate(prev: Props<T>) {
    if (prev.rows !== this.props.rows) {
      this.list.setOptions(this.options(this.props.rows));
      this.list._willUpdate();
      this.forceUpdate();
    }
    if (prev.selected !== this.props.selected) this.revealSelection();
  }
  componentWillUnmount() {
    this.detach?.();
  }
  private revealSelection() {
    if (!this.props.selected || !this.viewport.current?.offsetHeight) return;
    const selected = this.props.rows.findIndex((r) => r.id === this.props.selected);
    if (selected < 0) return;
    if (this.list.options.enabled) this.list.scrollToIndex(selected, { align: "auto" });
    else this.viewport.current.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }
  private cell(row: T, index: number) {
    return (
      <div
        key={row.id}
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={this.props.rows.length}
        data-index={index}
      >
        {this.props.children(row)}
      </div>
    );
  }
  render() {
    const { rows } = this.props,
      items = this.list.getVirtualItems();
    return (
      <div
        ref={this.viewport}
        className={rows.length > 60 ? "conversation-scroll windowed" : "conversation-scroll"}
        role="list"
        aria-label="Conversations"
      >
        {this.list.options.enabled ? (
          <>
            <svg aria-hidden="true" width="1" height={items[0]?.start || 0} />
            {items.map((i) => rows[i.index] && this.cell(rows[i.index], i.index))}
            <svg
              aria-hidden="true"
              width="1"
              height={Math.max(0, this.list.getTotalSize() - (items.at(-1)?.end || 0))}
            />
          </>
        ) : (
          rows.map((r, i) => this.cell(r, i))
        )}
      </div>
    );
  }
}
