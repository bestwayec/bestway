import {
  Bell,
  BookOpen,
  CalendarCheck,
  ClipboardCheck,
  GraduationCap,
  Images,
  LayoutDashboard,
  Newspaper,
  PlaySquare,
  ScrollText,
  Settings,
  SquarePen,
  Trophy,
  UserCog,
  Users,
  Wallet,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "./types";
import { homePathForRole } from "./role-routing";

export interface NavItem {
  href: string;
  /** "nav" namespace kaliti */
  key: string;
  icon: LucideIcon;
  roles: Role[];
  /** Mobil pastki menyuda ko'rinadimi */
  mobile?: boolean;
}

const STAFF: Role[] = ["teacher", "admin", "super_admin"];
const OFFICE: Role[] = ["admin", "super_admin"];
const SUPER: Role[] = ["super_admin"];
const ALL: Role[] = ["super_admin", "admin", "teacher", "student", "parent"];

/** Butun navigatsiya ro'yxati — rol bo'yicha filtrlanadi */
const NAV: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, roles: ALL, mobile: true },
  { href: "/attendance", key: "attendance", icon: CalendarCheck, roles: STAFF, mobile: true },
  { href: "/payments", key: "payments", icon: Wallet, roles: STAFF, mobile: true },
  { href: "/students", key: "students", icon: Users, roles: OFFICE, mobile: true },
  { href: "/groups", key: "groups", icon: BookOpen, roles: STAFF },
  { href: "/staff", key: "staff", icon: UserCog, roles: OFFICE },
  { href: "/mock", key: "mock", icon: ClipboardCheck, roles: ["student", "teacher", "admin", "super_admin"] },
  { href: "/exam-builder", key: "examBuilder", icon: SquarePen, roles: STAFF },
  { href: "/videos", key: "videos", icon: PlaySquare, roles: ALL },
  { href: "/articles", key: "articles", icon: Newspaper, roles: OFFICE },
  { href: "/gallery", key: "gallery", icon: Images, roles: OFFICE },
  { href: "/leaderboard", key: "leaderboard", icon: Trophy, roles: ["student", "teacher"], mobile: true },
  { href: "/children", key: "children", icon: GraduationCap, roles: ["parent"], mobile: true },
  // Student exam track selector — placed before profile/settings conceptually
  { href: "/exam-track", key: "examTrack", icon: Target, roles: ["student"] },
  // Eslatma: notifications ataylab primary emas — AppTopbar'dagi qo'ng'iroqcha
  // (NotificationsBell) barcha viewport'larda mavjud, slotni keraksiz egallamasin.
  { href: "/notifications", key: "notifications", icon: Bell, roles: ALL },
  { href: "/settings", key: "settings", icon: Settings, roles: SUPER },
  { href: "/audit", key: "audit", icon: ScrollText, roles: SUPER },
];

export function navForRole(role: Role): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role)).map((item) =>
    item.key === "dashboard" ? { ...item, href: homePathForRole(role) } : item,
  );
}

/**
 * Mobil pastki menyu uchun BIRLAMCHI (4 slot) bo'limlar.
 * 5-slot doim "More" tugmasiga ajratilgan (komponentda qo'shiladi, bu ro'yxatda emas).
 * Qolgan barcha rolga mos bo'limlar `navForRole()` orqali "More" panelida chiqadi.
 */
export function mobileNavForRole(role: Role): NavItem[] {
  return navForRole(role).filter((item) => item.mobile).slice(0, 4);
}

/** Faol yo'nalishni aniqlash — /dashboard aniq, qolganlari prefiks bo'yicha */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/super-admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
