import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useDisclosureAnchorNotifier } from "../../../lib/disclosure-anchor-context";
import {
  createThinkingDisclosureController,
  DisclosureChoices,
  disclosureKindFromKey,
  type ThinkingDisclosureController,
} from "./disclosure-state";

const ChoicesContext = createContext<DisclosureChoices | null>(null);
const ParentContext = createContext<{ claim: () => void; visible: boolean }>({
  claim: () => {},
  visible: true,
});

/**
 * The retained session pane owns this map; no state is persisted to the host.
 *
 * `onControllerChange` publishes the pane's thinking-disclosure controller to
 * the app shell, which is what lets the toolbar button and the global shortcut
 * act on the visible session's rows without hoisting this provider. It is
 * reported from a passive effect so the rows have registered their kinds by
 * then, and cleared on unmount so a closed pane cannot be toggled.
 */
export function TranscriptDisclosureProvider({
  children,
  onControllerChange,
}: {
  children: ReactNode;
  onControllerChange?: (controller: ThinkingDisclosureController | null) => void;
}) {
  const [choices] = useState(() => new DisclosureChoices());
  const controller = useMemo(
    () => createThinkingDisclosureController(choices),
    [choices],
  );
  useEffect(() => {
    if (!onControllerChange) return;
    onControllerChange(controller);
    return () => onControllerChange(null);
  }, [controller, onControllerChange]);
  return <ChoicesContext.Provider value={choices}>{children}</ChoicesContext.Provider>;
}

export function disclosureKey(kind: string, ...ids: string[]) {
  return JSON.stringify([kind, ...ids]);
}

/**
 * Row bookkeeping for the thinking-disclosure action: which kind a key belongs
 * to, and the default the row shows without an explicit choice.
 *
 * Callers use it from a layout effect, so no metadata is written while React
 * renders, and recording can never change what the row itself derives.
 */
export function useThinkingDisclosure() {
  const sharedChoices = useContext(ChoicesContext);
  const [localChoices] = useState(() => new DisclosureChoices());
  const choices = sharedChoices ?? localChoices;
  return useCallback(
    (key: string, kind: string | undefined, autoDefault: boolean) => {
      if (kind === undefined) return;
      choices.setKind(key, kind);
      choices.setAutoDefault(key, autoDefault);
    },
    [choices],
  );
}

function ownsReadingPosition(body: HTMLElement | null): boolean {
  if (!body) return false;
  if (body.contains(document.activeElement)) return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && (
    body.contains(selection.anchorNode) || body.contains(selection.focusNode)
  ));
}

export function useAutomaticDisclosure(
  automaticOpen: boolean,
  revealRequest?: number,
  identity?: string,
) {
  const sharedChoices = useContext(ChoicesContext);
  const [localChoices] = useState(() => new DisclosureChoices());
  const choices = sharedChoices ?? localChoices;
  const fallbackId = useId();
  const key = identity ?? fallbackId;
  const parent = useContext(ParentContext);
  const subscribe = useCallback((listener: () => void) => choices.subscribe(key, listener), [choices, key]);
  const snapshot = useCallback(() => choices.get(key), [choices, key]);
  const choice = useSyncExternalStore(subscribe, snapshot, snapshot);
  // A pending reveal is the derived default, so the first paint (and SSR)
  // already shows the row the transcript search asked to open.
  const automaticDefault =
    revealRequest !== undefined && choice?.revealRequest !== revealRequest
      ? true
      : automaticOpen;
  const open = choice?.open ?? automaticDefault;

  // The row's kind is read back from its own key, so no call site has to pass it
  // twice, and a row without a disclosure key stays outside the thinking family.
  // Recording happens in a layout effect: metadata may not change what this row
  // derives above, and it only feeds the transcript-wide expand/collapse action.
  const registerRow = useThinkingDisclosure();
  const kind = useMemo(() => disclosureKindFromKey(key), [key]);
  useLayoutEffect(() => {
    registerRow(key, kind, automaticDefault);
  }, [automaticDefault, key, kind, registerRow]);
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const notifyAnchor = useDisclosureAnchorNotifier();
  const currentOpen = useRef(open);
  currentOpen.current = open;

  const claim = useCallback(() => {
    if (!choices.get(key)) choices.set(key, { open: currentOpen.current });
    parent.claim();
  }, [choices, key, parent.claim]);

  useLayoutEffect(() => {
    if (revealRequest === undefined || choices.get(key)?.revealRequest === revealRequest) return;
    choices.set(key, { open: true, revealRequest });
    parent.claim();
  }, [choices, key, parent.claim, revealRequest]);

  const previousOpen = useRef(open);
  useLayoutEffect(() => {
    // Completion must not hide keyboard focus or an active text selection.
    if (previousOpen.current && !open && !choice && ownsReadingPosition(bodyRef.current)) {
      choices.set(key, { open: true });
      parent.claim();
    }
    previousOpen.current = open;
  }, [choice, choices, key, open, parent.claim]);

  const setManualOpen = useCallback((next: boolean) => {
    parent.claim();
    notifyAnchor?.(titleRef.current);
    if (!next && bodyRef.current?.contains(document.activeElement)) {
      titleRef.current?.focus({ preventScroll: true });
    }
    choices.set(key, { ...choices.get(key), open: next });
  }, [choices, key, notifyAnchor, parent.claim]);
  const toggle = useCallback(() => setManualOpen(!currentOpen.current), [setManualOpen]);
  const collapse = useCallback(() => setManualOpen(false), [setManualOpen]);

  return {
    open,
    toggle,
    collapse,
    claim,
    titleRef,
    bodyRef,
    parentVisible: parent.visible,
    // Pointer selection and keyboard interaction establish ownership before
    // a streaming update can apply an automatic close.
    bodyEvents: { onPointerDownCapture: claim, onFocusCapture: claim },
  };
}

export function DisclosureScope({
  disclosure,
  open = disclosure.open,
  children,
}: {
  disclosure: ReturnType<typeof useAutomaticDisclosure>;
  open?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({
    claim: disclosure.claim,
    visible: disclosure.parentVisible && open,
  }), [disclosure.claim, disclosure.parentVisible, open]);
  return <ParentContext.Provider value={value}>{children}</ParentContext.Provider>;
}
