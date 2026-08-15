import { Link } from "wouter";
import { cn } from "@/lib/utils";

type BackButtonProps = {
  href?: string;
  onClick?: () => void;
  label?: string;
  iconOnly?: boolean;
  className?: string;
};

const content = (label: string, iconOnly: boolean) => (
  <>
    <span className="relative block h-4 w-4 shrink-0" aria-hidden="true">
      <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current" />
      <span className="absolute left-0 top-[4px] h-2 w-2 rotate-45 border-b border-l border-current" />
    </span>
    {!iconOnly && <span>{label}</span>}
  </>
);

export function BackButton({ href, onClick, label = "Voltar", iconOnly = false, className }: BackButtonProps) {
  const styles = cn(
    "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-background text-sm font-medium text-foreground shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
    iconOnly ? "w-10 px-0" : "px-4",
    className,
  );

  if (href) {
    return <Link href={href} aria-label={iconOnly ? label : undefined} className={styles}>{content(label, iconOnly)}</Link>;
  }

  return <button type="button" onClick={onClick} aria-label={iconOnly ? label : undefined} className={styles}>{content(label, iconOnly)}</button>;
}
