import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { PressedSegmented, ThemeSwitch, type PressedOption } from "@/components/app/theme-switch";
import { setPrefs, usePrefs, type Density } from "@/lib/prefs";
import { useProfile } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings · FiledUnder" },
      { name: "description", content: "Your FiledUnder profile and appearance settings." },
      { property: "og:title", content: "Settings · FiledUnder" },
      { property: "og:description", content: "Your FiledUnder profile and appearance settings." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

const DENSITY_OPTIONS: PressedOption<Density>[] = [
  { value: "reading", label: "Reading" },
  { value: "dense", label: "Dense" },
];

function SettingsPage() {
  const me = useProfile();
  const [prefs] = usePrefs();
  const email = me.data?.user.email ?? null;
  const name = me.data?.profile?.display_name || null;
  const loading = me.isLoading;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={<span className="text-xl font-semibold">Settings</span>} />
      <div className="grid grid-cols-1 gap-4">
        <Panel
          id="profile"
          title={<span className="text-sm font-medium">Profile</span>}
          collapse={false}
          className="scroll-mt-20 rounded-[10px] border"
        >
          <dl className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
            <Field label="Display name" helper="The name shown in your account menu.">
              {loading ? "Loading" : (name ?? "Not set")}
            </Field>
            <Field label="Sign-in email" helper="The address you use to sign in to FiledUnder.">
              {loading ? "Loading" : (email ?? "Not available")}
            </Field>
          </dl>
        </Panel>

        <Panel
          id="appearance"
          title={<span className="text-sm font-medium">Appearance</span>}
          collapse={false}
          className="scroll-mt-20 rounded-[10px] border"
        >
          <div className="grid grid-cols-1 gap-5">
            <Control
              id="settings-theme"
              label="Theme"
              helper="System follows your device setting. Public pages stay light."
              note="Dark theme is new. Reports, exports and filing documents stay on light paper."
            >
              <ThemeSwitch
                labelledBy="settings-theme-label"
                describedBy="settings-theme-help settings-theme-note"
              />
            </Control>
            <Control
              id="settings-density"
              label="Density"
              helper="Dense fits more rows on screen in tables and lists."
            >
              <PressedSegmented
                value={prefs.density}
                options={DENSITY_OPTIONS}
                onChange={(density) => setPrefs({ density })}
                labelledBy="settings-density-label"
                describedBy="settings-density-help"
              />
            </Control>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-foreground">{children}</dd>
      <dd className="mt-1 text-xs text-muted-foreground">{helper}</dd>
    </div>
  );
}

function Control({
  id,
  label,
  helper,
  note,
  children,
}: {
  id: string;
  label: string;
  helper: string;
  /** Optional second helper line, id `${id}-note` */
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[13px] font-medium text-foreground">
          {label}
        </p>
        <p id={`${id}-help`} className="mt-0.5 text-xs text-muted-foreground">
          {helper}
        </p>
        {note && (
          <p id={`${id}-note`} className="mt-0.5 text-xs text-muted-foreground">
            {note}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
