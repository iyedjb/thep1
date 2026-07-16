import type { ReactNode } from "react";
import { Logo } from "../layout/logo";

type AuthShellProps = {
  children: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
};

export function AuthShell({ children, eyebrow, title, description }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-50 lg:grid lg:grid-cols-[1fr_1fr]">
      {/* Left: Form panel */}
      <section className="relative flex min-h-screen flex-col justify-center px-8 py-12 sm:px-12 lg:px-16 xl:px-24">
        {/* Logo */}
        <div className="absolute left-8 top-8 flex items-center gap-2.5 sm:left-12 lg:left-16 xl:left-24">
          <Logo iconSize={34} textClass="text-[#08214D]" forceTheme="light" />
        </div>

        {/* Form content */}
        <div className="mx-auto w-full max-w-[400px] pt-10">
          <div className="mb-8 animate-slide-up">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</span>
            </div>
            <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.03em] text-[#08214D] sm:text-[2.15rem]">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "60ms" }}>
            {children}
          </div>
        </div>

        <p className="absolute bottom-6 left-0 w-full px-8 text-center text-[11px] text-slate-400">
          © 2025 ClicLab. Seus dados permanecem protegidos.
        </p>
      </section>

      {/* Right: SVG visual panel - white background with centered logo */}
      <aside className="relative hidden min-h-screen overflow-hidden lg:flex lg:items-center lg:justify-center border-l border-slate-100 bg-white dark:bg-white">
        {/* Subtle light gradient bg */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5" />
        <div className="absolute inset-0 bg-dots-grid opacity-[0.08] invert" />

        {/* Centered logo in original horizontal format and label */}
        <div className="relative z-10 w-full flex flex-col items-center justify-center px-8 text-center animate-slide-up">
          <Logo iconSize={72} textSizeClass="text-5xl" textClass="text-[#08214D]" forceTheme="light" className="mb-4 drop-shadow-sm" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-[#0066FF]">
            ads inteligence plataform
          </p>
        </div>
      </aside>
    </main>
  );
}
