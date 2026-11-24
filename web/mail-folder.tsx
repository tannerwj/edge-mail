import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function MailFolder({
  title,
  mailbox,
  icon: Icon,
  children,
}: {
  title: string;
  mailbox: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="mail-folder">
      <header>
        <span className="folder-icon">
          <Icon size={21} />
        </span>
        <div>
          <small>{mailbox}</small>
          <h1>{title}</h1>
        </div>
      </header>
      {children}
    </section>
  );
}
export function FolderEmpty({
  title,
  children,
  icon: Icon,
}: {
  title: string;
  children: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="folder-empty">
      <Icon size={32} strokeWidth={1.4} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
