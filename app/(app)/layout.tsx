import Link from "next/link";
import { Home, ReceiptText, Send, Sparkles, UsersRound, WalletCards } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/forecast", label: "Forecast", icon: Sparkles },
  { href: "/payments", label: "Payments", icon: Send },
  { href: "/bills/new", label: "Upload bill", icon: ReceiptText },
  { href: "/households", label: "Household", icon: UsersRound }
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-[15px]">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-background/80 backdrop-blur-xl dark:border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950">
              <WalletCards className="h-4 w-4" />
            </span>
            SplitNest
          </Link>
          <nav className="hidden items-center gap-1 rounded-full border bg-card/70 p-1 shadow-hairline backdrop-blur md:flex">
            {nav.map((item) => (
              <Button key={item.href} asChild variant="ghost" size="sm">
                <Link href={item.href}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </Button>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-8">{children}</main>
      <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-5 rounded-[1.4rem] border bg-background/95 p-1 shadow-soft backdrop-blur md:hidden">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] text-muted-foreground transition active:scale-95 hover:bg-muted hover:text-foreground"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
