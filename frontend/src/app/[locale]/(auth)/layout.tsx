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
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg-subtle text-fg">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" aria-label="BESTWAY EC" className="rounded-control">
          <Brand />
        </Link>
        <div className="flex items-center gap-1.5">
          <LanguageSwitcher />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-10 pt-2 sm:items-center sm:py-8">
        <div className="w-full max-w-sm sm:max-w-md">{children}</div>
      </main>
    </div>
  );
}
