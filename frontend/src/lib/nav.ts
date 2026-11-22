import {
  Bell,
  BookA,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Images,
  LayoutDashboard,
  Newspaper,
  PlaySquare,
  ScrollText,
  Settings,
  SquarePen,
  Swords,
  Trophy,
  User,
  UserCog,
  Users,
  Wallet,
  Target,
  BarChart3,
  Compass,
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
  // Teachers: /dashboard IS the Teacher Workspace, so the separate entry is shown to the office only (no duplicate menu).
  { href: "/teacher", key: "teacherWorkspace", icon: GraduationCap, roles: OFFICE, mobile: true },
  { href: "/teacher/results", key: "homework", icon: ClipboardList, roles: STAFF, mobile: true },
  { href: "/homework", key: "myHomework", icon: ClipboardList, roles: ["student"], mobile: true },
  { href: "/staff", key: "staff", icon: UserCog, roles: OFFICE },
  { href: "/mock", key: "mock", icon: Target, roles: ["student", "teacher", "admin", "super_admin"], mobile: true },
  { href: "/vocabulary", key: "vocabulary", icon: BookA, roles: ["student", "teacher", "admin", "super_admin"], mobile: true },
  { href: "/bamboozle", key: "bamboozle", icon: Swords, roles: ["student", "teacher", "admin", "super_admin"], mobile: true },
  { href: "/exam-builder", key: "examBuilder", icon: SquarePen, roles: STAFF },
  { href: "/videos", key: "videos", icon: PlaySquare, roles: ALL },
  { href: "/articles", key: "articles", icon: Newspaper, roles: OFFICE },
  { href: "/gallery", key: "gallery", icon: Images, roles: OFFICE },
  { href: "/leaderboard", key: "leaderboard", icon: Trophy, roles: ["student", "teacher"], mobile: true },
  { href: "/profile", key: "profile", icon: User, roles: ["student"], mobile: true },
  { href: "/children", key: "children", icon: GraduationCap, roles: ["parent"], mobile: true },
  { href: "/exam-track", key: "examTrack", icon: Compass, roles: ["student"] },
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
 * Talaba uchun 4 ta asosiy bo'lim:
 * 1. Bosh sahifa
 * 2. Imtihonlar
 * 3. Darslar
 * 4. Natijalar
 */
export function primaryNavForRole(role: Role): NavItem[] {
  if (role === "student") {
    return [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, roles: ["student"], mobile: true },
      { href: "/homework", key: "myHomework", icon: ClipboardList, roles: ["student"], mobile: true },
      { href: "/mock", key: "mock", icon: Target, roles: ["student"], mobile: true },
      { href: "/profile", key: "results", icon: BarChart3, roles: ["student"], mobile: true },
    ];
  }
  return navForRole(role).filter((item) => item.key !== "notifications");
}

/**
 * Talaba uchun "Yana" bo'limiga ko'chirilgan yordamchi bo'limlar:
 * Lug'at, Bamboozle Arena, Reyting, Yo'nalish
 */
export function secondaryNavForRole(role: Role): NavItem[] {
  if (role === "student") {
    return [
      { href: "/videos", key: "videos", icon: PlaySquare, roles: ["student"] },
      { href: "/vocabulary", key: "vocabulary", icon: BookA, roles: ["student"] },
      { href: "/bamboozle", key: "bamboozle", icon: Swords, roles: ["student"] },
      { href: "/leaderboard", key: "leaderboard", icon: Trophy, roles: ["student"] },
      { href: "/exam-track", key: "examTrack", icon: Compass, roles: ["student"] },
    ];
  }
  return [];
}

/**
 * Mobil pastki menyu uchun BIRLAMCHI (4 slot) bo'limlar.
 */
export function mobileNavForRole(role: Role): NavItem[] {
  if (role === "student") {
    return primaryNavForRole("student");
  }
  const items = navForRole(role);
  if (role === "teacher") {
    const priorities = ["dashboard", "attendance", "homework", "groups"];
    return priorities.flatMap((key) => items.filter((item) => item.key === key));
  }
  return items.filter((item) => item.mobile).slice(0, 4);
}

/** Faol yo'nalishni aniqlash — /dashboard aniq, qolganlari prefiks bo'yicha */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/super-admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sidebar sections for the office / teacher / parent roles. Built only from the role-filtered list above
 * (navForRole), so a section can never reach a route the role is not allowed to see.
 */
export type NavSectionId = "learning" | "exams" | "users" | "reports" | "settings";

export const NAV_SECTION_ORDER: NavSectionId[] = ["learning", "exams", "users", "reports", "settings"];

const SECTION_OF: Record<string, NavSectionId> = {
  teacherWorkspace: "learning",
  groups: "learning",
  vocabulary: "learning",
  bamboozle: "learning",
  videos: "learning",
  articles: "learning",
  gallery: "learning",
  leaderboard: "learning",
  mock: "exams",
  examBuilder: "exams",
  examTrack: "exams",
  students: "users",
  staff: "users",
  children: "users",
  profile: "users",
  attendance: "reports",
  payments: "reports",
  audit: "reports",
  settings: "settings",
};

export interface NavSection {
  id: NavSectionId;
  items: NavItem[];
}

export interface GroupedNav {
  /** Always visible, outside any section (the role's home page). */
  top: NavItem[];
  sections: NavSection[];
}

export function groupedNavForRole(role: Role): GroupedNav {
  const items = navForRole(role).filter((item) => item.key !== "notifications");
  const top = items.filter((item) => item.key === "dashboard");
  const sections = NAV_SECTION_ORDER.map((id) => ({
    id,
    items: items.filter((item) => item.key !== "dashboard" && (SECTION_OF[item.key] ?? "learning") === id),
  })).filter((section) => section.items.length > 0);
  return { top, sections };
}
