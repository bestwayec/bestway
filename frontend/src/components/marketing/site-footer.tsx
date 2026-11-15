import { Mail, MapPin, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Brand } from "@/components/brand";
import { CENTER } from "@/lib/config";
import { formatPhone } from "@/lib/utils";
import TextType from "@/components/ui/text-type";

export function SiteFooter() {
  const t = useTranslations("marketing");
  const year = new Date().getFullYear();

  return (
    <footer className="marketing-footer relative overflow-hidden border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-8 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Link href="/" aria-label={CENTER.name} className="inline-flex transition-transform hover:scale-[1.02]">
              <Brand size="lg" />
            </Link>
            <div className="mt-4 max-w-sm min-h-[1.4em]">
              <TextType
                text="Do your best, forget the rest!"
                typingSpeed={40}
                initialDelay={300}
                pauseDuration={2500}
                deletingSpeed={30}
                loop={true}
                showCursor={true}
                cursorCharacter="▎"
                cursorBlinkDuration={0.5}
                className="block text-sm leading-relaxed text-fg-muted"
              />
            </div>
            <p className="mt-3 text-xs text-fg-subtle">
              {t("founderLabel")}: <span className="font-medium text-fg-muted">{CENTER.founder}</span>{" "}
              · {t("foundedLabel")} {CENTER.established}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fg">{t("coursesTitle")}</h3>
            <ul className="mt-3 space-y-2 text-sm text-fg-muted">
              <li>IELTS</li>
              <li>Multilevel</li>
              <li>SAT</li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-fg">{t("contactTitle")}</h3>
            <ul className="mt-3 space-y-2.5 text-sm text-fg-muted">
              <li className="flex items-center gap-2.5">
                <Phone className="size-4 shrink-0 text-brand" />
                <a href={`tel:${CENTER.phone.replace(/\s/g, "")}`} className="hover:text-fg">
                  {formatPhone(CENTER.phone)}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <Mail className="size-4 shrink-0 text-brand" />
                <a href={`mailto:${CENTER.email}`} className="hover:text-fg">
                  {CENTER.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                <a
                  href={CENTER.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-fg"
                >
                  {CENTER.address}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-fg-subtle sm:flex-row">
          <p>
            © {year} {CENTER.name}. {t("footerRights")}
          </p>
          <div className="flex items-center gap-4">
            <Link href="/desktop" className="hover:text-fg">
              {t("desktopApp")}
            </Link>
            <Link href="/login" className="hover:text-fg">
              {t("login")}
            </Link>
            <Link href="/register" className="hover:text-fg">
              {t("heroCta")}
            </Link>
          </div>
        </div>
      </div>

      {/* Katta so'z belgisi — bir qatorda, zamonaviy saytlardagidek */}
      <div aria-hidden className="relative flex justify-center overflow-hidden select-none">
        <p className="translate-y-[16%] bg-gradient-to-r from-brand/30 via-accent/25 to-orange/30 bg-clip-text text-[18.5vw] leading-none font-black whitespace-nowrap tracking-tighter text-transparent">
          {CENTER.name}
        </p>
      </div>
    </footer>
  );
}
