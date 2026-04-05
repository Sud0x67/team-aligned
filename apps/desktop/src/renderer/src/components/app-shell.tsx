import { useMemo, useState } from "react";
import {
  Bell,
  Blocks,
  ChevronLeft,
  ChevronRight,
  FolderCog,
  LayoutDashboard,
  MessageSquare,
  MoonStar,
  Settings,
  SunMedium,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { createTranslator } from "../i18n";
import { useAppStore } from "../store/use-app-store";
import { ProfileModal } from "./profile-modal";
import { TeamAlignedLogo } from "./teamaligned-logo";

function formatRelativeTime(timestamp: number, t: ReturnType<typeof createTranslator>) {
  const diff = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} ${t.common("minutesAgo")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${t.common("hoursAgo")}`;
  return `${Math.round(hours / 24)} ${t.common("daysAgo")}`;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const settings = useAppStore((state) => state.settings);
  const profile = useAppStore((state) => state.profile);
  const notifications = useAppStore((state) => state.notifications);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const markNotificationsRead = useAppStore((state) => state.markNotificationsRead);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const t = createTranslator(settings.language);

  const navItems = [
    { to: "/", label: t.common("conversations"), icon: MessageSquare },
    { to: "/manage", label: t.manage("title"), icon: FolderCog },
    { to: "/extensions", label: t.extensions("title"), icon: Blocks },
    { to: "/dashboard", label: t.dashboard("title"), icon: LayoutDashboard },
    { to: "/settings", label: t.settings("title"), icon: Settings },
  ];

  const pageTitles: Record<string, string> = {
    "/": t.common("conversations"),
    "/manage": t.manage("title"),
    "/extensions": t.extensions("title"),
    "/dashboard": t.dashboard("title"),
    "/settings": t.settings("title"),
  };

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !item.read),
    [notifications],
  );

  const title = pageTitles[location.pathname] ?? "teamaligned";

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <aside
        className={`relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-[var(--sidebar-border)] bg-[var(--sidebar)] transition-all duration-300 ${
          collapsed ? "w-[68px]" : "w-[240px]"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--sidebar-border)] px-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--primary)] text-white">
            <TeamAlignedLogo className="h-5 w-5" />
          </div>
          {!collapsed ? (
            <div>
              <p className="text-sm font-semibold text-[var(--sidebar-foreground)]">TeamAligned</p>
              <p className="text-xs text-[var(--muted-foreground)]">local-first ai workspace</p>
            </div>
          ) : null}
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-[var(--primary)]"
                    : "text-[var(--sidebar-foreground)] hover:bg-[var(--sidebar-accent)]",
                ].join(" ")
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed ? <span>{label}</span> : null}
              {!collapsed && to === "/" && unreadNotifications.length > 0 ? (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[11px] text-white">
                  {unreadNotifications.length}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--sidebar-border)] p-3">
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-accent)]"
            onClick={() => {
              void updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" });
            }}
          >
            {settings.theme === "dark" ? (
              <SunMedium className="h-5 w-5 shrink-0" />
            ) : (
              <MoonStar className="h-5 w-5 shrink-0" />
            )}
            {!collapsed ? <span>{settings.theme === "dark" ? t.common("lightMode") : t.common("darkMode")}</span> : null}
          </button>

          <button
            className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[var(--sidebar-foreground)] transition-colors hover:bg-[var(--sidebar-accent)]"
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5 shrink-0" />
            ) : (
              <ChevronLeft className="h-5 w-5 shrink-0" />
            )}
            {!collapsed ? <span>{collapsed ? t.common("expandSidebar") : t.common("collapseSidebar")}</span> : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--card)] px-6">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted-foreground)]">teamaligned</p>
            <h1 className="mt-1 text-[20px] font-semibold tracking-tight">{title}</h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                className="relative grid h-10 w-10 place-items-center rounded-xl text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={() => {
                  const next = !notificationOpen;
                  setNotificationOpen(next);
                  if (next && unreadNotifications.length > 0) {
                    void markNotificationsRead();
                  }
                }}
              >
                <Bell className="h-5 w-5" />
                {unreadNotifications.length > 0 ? (
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-[var(--card)] bg-[var(--primary)]" />
                ) : null}
              </button>

              {notificationOpen ? (
                <>
                  <button
                    aria-label={t.common("notifications")}
                    className="fixed inset-0 z-10 cursor-default bg-transparent"
                    onClick={() => setNotificationOpen(false)}
                  />
                  <div className="absolute right-0 top-14 z-20 w-[360px] rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-3 shadow-soft">
                  <div className="flex items-center justify-between px-2 pb-3">
                    <div>
                      <p className="text-sm font-semibold">{t.common("notifications")}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {notifications.length} {t.common("notificationCount")}
                      </p>
                    </div>
                    <button
                      className="text-xs text-[var(--primary)]"
                      onClick={() => void markNotificationsRead()}
                    >
                      {t.common("markAllRead")}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {notifications.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-xl border px-4 py-3 ${
                          item.read
                            ? "border-[var(--border)] bg-[var(--panel)]"
                            : "border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{item.title}</p>
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {formatRelativeTime(item.createdAt, t)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                          {item.body}
                        </p>
                      </div>
                    ))}
                  </div>
                  </div>
                </>
              ) : null}
            </div>

            <button
              className="flex items-center gap-3 rounded-full bg-[var(--primary)] px-2.5 py-1.5 text-white transition hover:opacity-90"
              onClick={() => setProfileOpen(true)}
            >
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white/15 text-sm font-semibold text-white">
                {profile.avatarPath ? (
                  <img src={profile.avatarPath} alt={profile.name} className="h-full w-full object-cover" />
                ) : (
                  profile.name.slice(0, 1) || "A"
                )}
              </div>
              <div className="hidden text-left md:block">
                <p className="text-sm font-medium">{profile.name}</p>
                <p className="text-xs text-white/70">{profile.role || t.common("unsetRole")}</p>
              </div>
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
