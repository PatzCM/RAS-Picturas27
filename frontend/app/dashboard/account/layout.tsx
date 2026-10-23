"use client";

import { AccountSidebar } from "@/components/account-sidebar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSession } from "@/providers/session-provider";
import { redirect, RedirectType, usePathname, useRouter } from "next/navigation";
import { useLayoutEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const path = usePathname();
  const router = useRouter();

  const pages = {
    account: "Account",
    billing: "Billing",
    upgrade: "Upgrade to Premium",
  };

  const session = useSession();

  useLayoutEffect(() => {
    if (session.user.type === "anonymous") {
      redirect("/login", RedirectType.replace);
    }
  }, [session.user.type]);

  if (session.user.type !== "anonymous")
    return (
      <div className="flex">
        <AccountSidebar />
        <main className="px-4 sm:px-10 md:px-24 lg:px-32 xl:px-40 py-4 sm:py-8 flex flex-col w-full h-screen overflow-y-scroll overflow-x-hidden">
          <div className="flex items-center justify-between pb-4 sm:pb-8">
            <div className="flex gap-4 items-center">
              <SidebarTrigger
                variant="secondary"
                className="h-9 w-10 lg:hidden"
              />
              {path.split("/").pop() !== "upgrade" && (
                <h1 className="font-bold text-3xl">
                  {
                    pages[
                      (path.split("/").pop() ?? "account") as
                        | "account"
                        | "billing"
                        | "upgrade"
                    ]
                  }
                </h1>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="size-4" /> Back to Dashboard
            </Button>
          </div>
          {children}
        </main>
      </div>
    );
}
