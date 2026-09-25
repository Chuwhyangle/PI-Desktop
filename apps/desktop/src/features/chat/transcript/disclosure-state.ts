/**
 * Bookkeeping for the transcript's collapsible rows, plus the "expand or
 * collapse every thinking block" rule.
 *
 * `disclosure.tsx` keeps the React bindings; this module stays free of React and
 * the DOM so the rules that a transcript-wide action has to obey can be
 * exercised directly by `node --test`.
 */

export type Choice = {
  open: boolean;
  revealRequest?: number;
};

/**
 * What a row shows while it has no explicit choice, plus the kind it belongs to.
 *
 * Recorded beside the choices instead of inside them: a metadata write must
 * never create a `Choice`, because a synthetic `open` would shadow the automatic
 * default a streaming row has to keep following.
 */
type RowMeta = {
  kind?: string;
  autoDefault?: boolean;
};

/** The leaf rows that carry thinking content. */
export const THINKING_ROW_KIND = "thinking";

/**
 * The thinking family: the thinking rows plus the containers that hold them.
 *
 * The containers have to move with the leaves, because a collapsed turn,
 * activity group, or hosted-search group keeps its children mounted but hidden —
 * expanding a thinking row alone would leave it invisible. Tool keys are
 * deliberately absent: the action must never change a tool call's disclosure.
 */
export const THINKING_DISCLOSURE_KINDS = [
  THINKING_ROW_KIND,
  "turn",
  "activity",
  "hostedSearch",
] as const;

const THINKING_KIND_SET: ReadonlySet<string> = new Set(THINKING_DISCLOSURE_KINDS);

export function isThinkingDisclosureKind(kind: string | undefined): boolean {
  return kind !== undefined && THINKING_KIND_SET.has(kind);
}

/**
 * The kind a `disclosureKey(kind, ...ids)` string was built from.
 *
 * A row's key is its whole identity, so re-reading the kind from it is what
 * keeps the existing call sites from having to pass their kind twice.
 */
export function disclosureKindFromKey(key: string): string | undefined {
  if (!key.startsWith("[")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    // A bare `useId()` fallback is not a disclosure key and has no kind.
    return undefined;
  }
  return Array.isArray(parsed) && typeof parsed[0] === "string"
    ? parsed[0]
    : undefined;
}

export type ThinkingDisclosureState = "none" | "expanded" | "collapsed";

/** Only explicit choices are retained; untouched nodes derive their defaults. */
export class DisclosureChoices {
  private choices = new Map<string, Choice>();
  private meta = new Map<string, RowMeta>();
  private listeners = new Map<string, Set<() => void>>();
  /** Map-level subscribers: the app shell reads one snapshot per session pane. */
  private metaListeners = new Set<() => void>();

  get = (key: string) => this.choices.get(key);

  set(key: string, choice: Choice) {
    const previous = this.choices.get(key);
    if (previous?.open === choice.open && previous.revealRequest === choice.revealRequest) return;
    this.choices.set(key, choice);
    this.listeners.get(key)?.forEach((listener) => listener());
    this.notifyMeta();
  }

  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  /** Watch the whole map; used by the shell's thinking-disclosure controller. */
  subscribeMeta(listener: () => void) {
    this.metaListeners.add(listener);
    return () => {
      this.metaListeners.delete(listener);
    };
  }

  /** Record which kind a key belongs to, so the action can tell rows apart. */
  setKind(key: string, kind: string) {
    const current = this.meta.get(key);
    if (current?.kind === kind) return;
    this.meta.set(key, { ...current, kind });
    this.notifyMeta();
  }

  /**
   * Record the default the row falls back to without an explicit choice.
   *
   * Both writers stay silent for the row itself — re-rendering it would change
   * nothing — and only wake the map-level subscribers that mirror the whole
   * pane, which is what the toolbar's expand/collapse state is read from.
   */
  setAutoDefault(key: string, autoDefault: boolean) {
    const current = this.meta.get(key);
    if (current?.autoDefault === autoDefault) return;
    this.meta.set(key, { ...current, autoDefault });
    this.notifyMeta();
  }

  /** True while this pane holds a thinking row the action could act on. */
  hasThinkingRows(): boolean {
    return this.keysOfKind(THINKING_ROW_KIND).length > 0;
  }

  /** True when any thinking row is collapsed right now. */
  hasClosedThinking(): boolean {
    return this.keysOfKind(THINKING_ROW_KIND).some((key) => !this.rowOpen(key));
  }

  /** Expand every thinking row and every container that hides one. */
  expandThinkingKinds() {
    this.setThinkingFamilyOpen(true);
  }

  /** Collapse every thinking row and the containers that hold them. */
  collapseThinkingKinds() {
    this.setThinkingFamilyOpen(false);
  }

  private setThinkingFamilyOpen(open: boolean) {
    for (const [key, meta] of this.meta) {
      if (!isThinkingDisclosureKind(meta.kind)) continue;
      this.set(key, { ...this.choices.get(key), open });
    }
  }

  private keysOfKind(kind: string): string[] {
    const keys: string[] = [];
    for (const [key, meta] of this.meta) {
      if (meta.kind === kind) keys.push(key);
    }
    return keys;
  }

  /** An explicit choice wins; otherwise the recorded default, then collapsed. */
  private rowOpen(key: string): boolean {
    return this.choices.get(key)?.open ?? this.meta.get(key)?.autoDefault ?? false;
  }

  private notifyMeta() {
    this.metaListeners.forEach((listener) => listener());
  }
}

/** What the toolbar button and the shortcut are looking at right now. */
export function thinkingDisclosureState(
  choices: DisclosureChoices,
): ThinkingDisclosureState {
  if (!choices.hasThinkingRows()) return "none";
  return choices.hasClosedThinking() ? "collapsed" : "expanded";
}

/**
 * Expand every thinking block while anything is collapsed, collapse the whole
 * thinking family otherwise. Returns the state it left behind; `"none"` means
 * the pane holds no thinking content and nothing was touched.
 */
export function toggleThinkingDisclosure(
  choices: DisclosureChoices,
): ThinkingDisclosureState {
  const state = thinkingDisclosureState(choices);
  if (state === "none") return state;
  if (state === "collapsed") choices.expandThinkingKinds();
  else choices.collapseThinkingKinds();
  return thinkingDisclosureState(choices);
}

export type ThinkingDisclosureController = {
  getState: () => ThinkingDisclosureState;
  subscribe: (listener: () => void) => () => void;
  /** Flip this pane's thinking blocks; never touches a tool row. */
  toggle: () => void;
};

export function createThinkingDisclosureController(
  choices: DisclosureChoices,
): ThinkingDisclosureController {
  return {
    getState: () => thinkingDisclosureState(choices),
    subscribe: (listener) => choices.subscribeMeta(listener),
    toggle: () => {
      toggleThinkingDisclosure(choices);
    },
  };
}
