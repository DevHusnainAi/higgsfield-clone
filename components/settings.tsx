"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { CheckCircle, Eye, EyeSlash, LockSimple } from "@phosphor-icons/react";
import { setStudioReduceMotion, studioReducesMotion, subscribeMotion, systemReducesMotion } from "@/lib/motion";
import { keyFormatError, PROVIDERS, type KeyStatus, type Provider } from "@/lib/provider-keys";
import { api, remoteEnabled, SyncError } from "@/lib/remote";
import { refresh, useStudio } from "@/lib/store";

interface Overview {
  permanent: boolean;
  balance: number;
  stats: { runs: number; done: number; failed: number; credits_used: number; credits_refunded: number };
  keys: Record<Provider, KeyStatus | null>;
  byok: boolean;
}

// Same control language as the sign-in form: recessed inputs (inner shadow, 3:1 control border), raised buttons.
// Focus: the global 2px accent ring (globals.css). Radius: 12px for form controls, 16px for cards.
const input =
  "h-10 w-full rounded-xl border border-line-control bg-bg px-3 font-mono text-base text-fg shadow-[inset_0_1px_2px_oklch(0_0_0/0.35)] transition-colors placeholder:font-sans placeholder:text-fg-muted focus-visible:border-accent/60 aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-60 md:text-ui";
const primary =
  "h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink inset-shadow-edge transition hover:brightness-105 motion-safe:active:scale-[0.98] aria-busy:cursor-progress aria-busy:btn-busy disabled:opacity-60";
const quiet =
  "h-8 rounded-lg px-2.5 text-ui text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:opacity-60";
const card = "rounded-2xl border border-line bg-surface inset-shadow-edge";

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold tracking-heading text-fg">{title}</h2>
        {description && <p className="max-w-[60ch] text-ui text-pretty text-fg-muted">{description}</p>}
      </header>
      {children}
    </section>
  );
}

const Skeleton = ({ className }: { className: string }) => <span aria-hidden className={`block rounded bg-fg/[0.06] motion-safe:animate-pulse ${className}`} />;

function AccountSection({ data }: { data: Overview | null }) {
  const { auth } = useStudio();
  const stats = data && [
    ["Runs", data.stats.runs],
    ["Completed", data.stats.done],
    ["Failed", data.stats.failed],
    ["Credits used", data.stats.credits_used],
    ["Credits refunded", data.stats.credits_refunded],
  ] as const;
  return (
    <Section title="Account">
      <div className={`${card} divide-y divide-line`}>
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-ui font-medium text-fg">{auth.status === "user" ? "Signed in" : auth.status === "anonymous" ? "Guest" : <Skeleton className="h-4 w-20" />}</span>
            <span className="truncate text-xs text-fg-muted">
              {auth.status === "user" ? auth.email ?? "No email on this account" : auth.status === "anonymous" ? "History stays in this browser until you sign in." : " "}
            </span>
          </div>
          {auth.status === "anonymous" && (
            <Link href="/sign-in" scroll={false} className="shrink-0 rounded-lg px-2.5 py-1.5 text-ui font-medium text-accent-text transition-colors hover:bg-accent/10">
              Sign in
            </Link>
          )}
        </div>
        <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
          <span className="text-ui text-fg-muted">Balance</span>
          {data ? <span className="text-ui font-medium tabular-nums text-fg">{data.balance} credits</span> : <Skeleton className="h-4 w-16" />}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 sm:grid-cols-5">
          {(stats ?? ["Runs", "Completed", "Failed", "Credits used", "Credits refunded"].map((l) => [l, null] as const)).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-xs text-fg-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums tracking-heading text-fg">{value ?? <Skeleton className="mt-1 h-5 w-8" />}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function KeyRow({
  provider,
  status,
  ready,
  locked,
  onChange,
}: {
  provider: Provider;
  status: KeyStatus | null;
  ready: boolean;
  /** Why keys can't be saved here (guest, or not enabled on this server), or null. */
  locked: string | null;
  onChange: (keys: Overview["keys"]) => void;
}) {
  const id = useId();
  const spec = PROVIDERS[provider];
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function call(kind: "save" | "remove", init: RequestInit, path = "/api/settings") {
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      const res = await api<{ keys?: Overview["keys"]; error?: string }>(path, init);
      if (!res.ok || !res.data.keys) throw new Error(res.data.error ?? "That didn't save. Try again.");
      onChange(res.data.keys);
      setValue("");
      setShown(false);
      setSaved(kind === "save" ? `Saved. Your renders now use this ${spec.label} key.` : `Removed. Renders use the shared studio keys again.`);
    } catch (err) {
      setError(err instanceof SyncError || err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    const problem = keyFormatError(provider, value); // instant feedback; the server checks again
    if (problem) return setError(problem);
    void call("save", { method: "PUT", body: JSON.stringify({ provider, key: value.trim() }) });
  };

  const disabled = !ready || locked !== null || busy !== null;
  return (
    <form onSubmit={save} className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label id={`${id}-label`} htmlFor={`${id}-key`} className="text-ui font-medium text-fg">
          {spec.label} <span className="font-mono text-xs font-normal text-fg-muted">{spec.env}</span>
        </label>
        {status ? (
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent-text">
              <CheckCircle size={14} weight="fill" aria-hidden /> Active custom key
              <span className="font-mono font-normal text-fg-muted">ending {status.hint}</span>
            </span>
            <button
              type="button"
              disabled={disabled}
              aria-busy={busy === "remove"}
              aria-label={`Remove ${spec.label} key`}
              onClick={() => void call("remove", { method: "DELETE" }, `/api/settings?provider=${provider}`)}
              className={`${quiet} -my-1.5 -mr-2.5 text-xs hover:text-danger`}
            >
              {busy === "remove" ? "Removing" : "Remove"}
            </button>
          </span>
        ) : (
          <span className="text-xs text-fg-muted">Using shared studio tier</span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={`${id}-key`}
            name={`${provider}-key`}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            placeholder={status ? "Paste a new key" : spec.example}
            aria-invalid={!!error}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            className={`${input} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            disabled={disabled}
            aria-pressed={shown}
            aria-label={shown ? "Hide key" : "Show key"}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-fg/[0.06] hover:text-fg disabled:opacity-60"
          >
            {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button type="submit" disabled={disabled || !value.trim()} aria-busy={busy === "save"} className={`${primary} w-20`}>
          {busy === "save" ? "Saving" : "Save"}
        </button>
      </div>
      {/* Also the live region: "Saved" / "Removed" replace the help text and are announced. */}
      <p id={`${id}-help`} aria-live="polite" className={`text-xs ${saved ? "text-fg" : "text-fg-muted"}`}>
        {saved ?? locked ?? spec.covers}
      </p>
      {error && <p id={`${id}-error`} role="alert" className="text-ui text-danger [overflow-wrap:anywhere]">{error}</p>}
    </form>
  );
}

function KeysSection({ data, onKeys }: { data: Overview | null; onKeys: (keys: Overview["keys"]) => void }) {
  const locked = !data ? null : !data.permanent ? "Sign in to add your own keys." : !data.byok ? "Custom keys aren't enabled on this server." : null;
  return (
    <Section
      title="Provider keys"
      description="Render on your own Hugging Face or fal.ai account instead of the shared studio tier, so its limits and billing are yours. Credits still apply."
    >
      <div className={`${card} divide-y divide-line`}>
        {(["hf", "fal"] as const).map((p) => (
          <KeyRow key={p} provider={p} status={data?.keys[p] ?? null} ready={!!data} locked={locked} onChange={onKeys} />
        ))}
      </div>
      <p className="flex max-w-[60ch] items-start gap-2 text-xs text-pretty text-fg-muted">
        <LockSimple size={14} className="mt-px shrink-0" aria-hidden />
        <span>
          Keys are encrypted (AES-256-GCM) before they&rsquo;re stored and decrypted only on the server, for your own renders. A saved key is never sent back to
          your browser: this page shows its last 4 characters. Removing it deletes it.
        </span>
      </p>
    </Section>
  );
}

function PreferencesSection() {
  // Each source separately. Server render: neither (the switch then hydrates to the real state).
  const system = useSyncExternalStore(subscribeMotion, systemReducesMotion, () => false);
  const studio = useSyncExternalStore(subscribeMotion, studioReducesMotion, () => false);
  const on = system || studio;
  const id = useId();
  return (
    <Section title="Preferences">
      <div className={card}>
        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span id={`${id}-label`} className="text-ui font-medium text-fg">Reduce motion</span>
            <span id={`${id}-desc`} className="text-xs text-pretty text-fg-muted">
              {system
                ? "On in your system settings, so it stays on here."
                : "Stops floating, pulsing and sliding animations, and video previews on hover. Saved on this device."}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-desc`}
            disabled={system}
            onClick={() => setStudioReduceMotion(!studio)}
            // Off: a 3:1 control border on the track. On: accent fill. The knob moves, but snaps under reduce.
            className="group relative h-6 w-10 shrink-0 rounded-full border border-line-control bg-bg shadow-[inset_0_1px_2px_oklch(0_0_0/0.35)] transition-colors aria-checked:border-accent aria-checked:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="absolute left-0.5 top-1/2 size-[18px] -translate-y-1/2 rounded-full bg-fg-muted shadow-sm transition-transform group-aria-checked:translate-x-4 group-aria-checked:bg-accent-ink" />
          </button>
        </div>
      </div>
    </Section>
  );
}

/** Settings: account summary, bring-your-own provider keys, and display preferences. */
export function Settings() {
  const { auth } = useStudio();
  // Loaded per account: after a sign-in, upgrade or sign-out, the previous account's answer no longer applies.
  const account = auth.status === "user" ? `user:${auth.email}` : auth.status;
  const [loaded, setLoaded] = useState<{ account: string; data: Overview | null; error: string | null } | null>(null);
  const current = loaded?.account === account ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const setData = (fn: (d: Overview) => Overview) => setLoaded((l) => l && l.data && { ...l, data: fn(l.data) });

  useEffect(() => {
    if (!remoteEnabled || account === "unknown") return;
    let live = true;
    const done = (data: Overview | null, error: string | null) => live && setLoaded({ account, data, error });
    api<Overview & { error?: string }>("/api/settings")
      .then((res) => (res.ok ? done(res.data, null) : done(null, res.data.error ?? "Couldn't load your settings.")))
      .catch((err: Error) => done(null, err.message));
    return () => {
      live = false;
    };
  }, [account]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 pb-16 pt-8 md:px-8 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-display text-fg">Settings</h1>
      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-ui text-fg [overflow-wrap:anywhere]">
          {error}
        </p>
      )}
      {remoteEnabled ? (
        <>
          <AccountSection data={data} />
          <KeysSection
            data={data}
            onKeys={(keys) => {
              setData((d) => ({ ...d, keys }));
              void refresh(); // a saved or removed key moves you on or off the free tier
            }}
          />
        </>
      ) : (
        <p className="text-ui text-fg-muted">Accounts aren&rsquo;t set up on this server, so there&rsquo;s no account or provider keys to manage. Everything you make stays in this browser.</p>
      )}
      <PreferencesSection />
    </div>
  );
}
