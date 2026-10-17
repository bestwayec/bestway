import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {/* dekorativ fon — modern obsidian dark glassmorphism */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(16,185,129,0.12),rgba(255,255,255,0))]" />
        <div className="anim-float absolute -top-24 -left-16 size-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="anim-float-slow absolute -bottom-24 -right-16 size-80 rounded-full bg-teal-500/10 blur-3xl" />
      </div>

      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label="BESTWAY EC" className="transition-transform hover:scale-[1.02]">
          <Brand />
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm sm:max-w-md">{children}</div>
      </main>
    </div>
  );
}
