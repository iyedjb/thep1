import type { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
};

export function AuthShell({ children, eyebrow, title, description }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[1fr_1fr]">
      {/* Left: Form panel */}
      <section className="relative flex min-h-screen flex-col justify-center px-8 py-12 sm:px-12 lg:px-16 xl:px-24">
        {/* Logo */}
        <div className="absolute left-8 top-8 flex items-center gap-2.5 sm:left-12 lg:left-16 xl:left-24">
          <div className="relative flex h-11 w-11 items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 text-primary">
              <rect x="3" y="15" width="2.5" height="5" rx="0.5" />
              <rect x="8" y="11" width="2.5" height="9" rx="0.5" />
              <rect x="13" y="8" width="2.5" height="12" rx="0.5" />
              <rect x="18" y="5" width="2.5" height="15" rx="0.5" />
              <path d="M2 13C6 11 12 7 21 3" />
              <path d="M16 3h5v5" />
            </svg>
          </div>
          <div className="leading-none">
            <span className="text-lg font-extrabold text-foreground tracking-tight">ClickLab</span>
          </div>
        </div>

        {/* Form content */}
        <div className="mx-auto w-full max-w-[400px] pt-10">
          <div className="mb-8 animate-slide-up">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</span>
            </div>
            <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.03em] text-foreground sm:text-[2.15rem]">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "60ms" }}>
            {children}
          </div>
        </div>

        <p className="absolute bottom-6 left-0 w-full px-8 text-center text-[11px] text-muted-foreground/50">
          © 2025 ClickLab. Seus dados permanecem protegidos.
        </p>
      </section>

      {/* Right: SVG visual panel */}
      <aside className="relative hidden min-h-screen overflow-hidden lg:flex lg:items-center lg:justify-center border-l border-border/30">
        {/* Subtle gradient bg */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/4 via-transparent to-violet-500/4" />
        <div className="absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-primary/6 blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[100px]" />
        <div className="absolute inset-0 bg-dots-grid opacity-30" />

        {/* Only the SVG */}
        <div className="relative z-10 w-full flex items-center justify-center px-8">
          <img
            src="/images/login-signup.svg"
            alt="ClickLab"
            className="w-full max-w-[580px] select-none object-contain drop-shadow-2xl"
            draggable={false}
          />
        </div>
      </aside>
    </main>
  );
}
