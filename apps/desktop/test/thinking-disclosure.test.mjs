import assert from "node:assert/strict";
import test from "node:test";

import {
  createThinkingDisclosureController,
  DisclosureChoices,
  disclosureKindFromKey,
  toggleThinkingDisclosure,
} from "../src/features/chat/transcript/disclosure-state.ts";

/** The keys the transcript actually builds, in the order the rows appear. */
const THINKING_A = JSON.stringify(["thinking", "msg-a"]);
const THINKING_B = JSON.stringify(["thinking", "msg-b"]);
const TURN = JSON.stringify(["turn", "turn-1"]);
const ACTIVITY = JSON.stringify(["activity", "msg-a", "thinking", ""]);
const HOSTED_SEARCH = JSON.stringify(["hostedSearch", "msg-a", "round-1"]);
const TOOL = JSON.stringify(["tool", "msg-tool"]);

/**
 * A pane holding two thinking rows inside a turn, an activity group and a
 * hosted-search group, plus one tool row. `openThinking` picks the starting
 * state of the two thinking rows via an explicit choice.
 */
function paneWithThinking({ openThinking }) {
  const choices = new DisclosureChoices();
  const rows = [
    [TURN, "turn", false],
    [ACTIVITY, "activity", false],
    [HOSTED_SEARCH, "hostedSearch", false],
    [THINKING_A, "thinking", false],
    [THINKING_B, "thinking", false],
    [TOOL, "tool", false],
  ];
  for (const [key, kind, autoDefault] of rows) {
    choices.setKind(key, kind);
    choices.setAutoDefault(key, autoDefault);
  }
  choices.set(THINKING_A, { open: openThinking });
  choices.set(THINKING_B, { open: openThinking });
  // A user-chosen tool state that the action must never touch.
  choices.set(TOOL, { open: false });
  return choices;
}

const openState = (choices, key) => choices.get(key)?.open;

test("expand path opens the thinking family and never a tool row", () => {
  const choices = paneWithThinking({ openThinking: false });

  assert.equal(toggleThinkingDisclosure(choices), "expanded");

  for (const key of [THINKING_A, THINKING_B, TURN, ACTIVITY, HOSTED_SEARCH]) {
    assert.equal(openState(choices, key), true, `${key} should be open`);
  }
  // The whole point of the feature: tool calls stay exactly as the user left them.
  assert.equal(openState(choices, TOOL), false);
});

test("collapse path folds the thinking family and never a tool row", () => {
  const choices = paneWithThinking({ openThinking: true });

  assert.equal(toggleThinkingDisclosure(choices), "collapsed");

  for (const key of [THINKING_A, THINKING_B, TURN, ACTIVITY, HOSTED_SEARCH]) {
    assert.equal(openState(choices, key), false, `${key} should be collapsed`);
  }
  assert.equal(openState(choices, TOOL), false);
});

test("the empty pane reports none and writes nothing", () => {
  const choices = new DisclosureChoices();
  choices.setKind(TURN, "turn");
  choices.setKind(TOOL, "tool");
  choices.set(TOOL, { open: true });

  assert.equal(toggleThinkingDisclosure(choices), "none");
  // `none` must be a no-op rather than a collapse of everything it can see.
  assert.equal(openState(choices, TURN), undefined);
  assert.equal(openState(choices, TOOL), true);
});

test("a collapsed thinking row inside an open pane still expands everything", () => {
  const choices = paneWithThinking({ openThinking: true });
  choices.set(THINKING_B, { open: false });

  assert.equal(toggleThinkingDisclosure(choices), "expanded");
  assert.equal(openState(choices, THINKING_A), true);
  assert.equal(openState(choices, THINKING_B), true);
  assert.equal(openState(choices, TURN), true);
});

test("recording kind and default never creates a choice of its own", () => {
  const choices = new DisclosureChoices();
  choices.setKind(THINKING_A, "thinking");
  choices.setAutoDefault(THINKING_A, true);

  // No explicit choice means the row keeps deriving its state from the value the
  // row itself computes; a synthetic choice here would freeze a streaming row.
  assert.equal(choices.get(THINKING_A), undefined);
  // Because the recorded default is open, the pane already reads as expanded, so
  // the first press collapses rather than expands.
  assert.equal(toggleThinkingDisclosure(choices), "collapsed");
  assert.equal(openState(choices, THINKING_A), false);
});
test("expanding preserves a pending reveal request", () => {
  const choices = paneWithThinking({ openThinking: false });
  choices.set(THINKING_A, { open: false, revealRequest: 7 });

  toggleThinkingDisclosure(choices);

  assert.equal(choices.get(THINKING_A).revealRequest, 7);
  assert.equal(openState(choices, THINKING_A), true);
});

test("disclosureKindFromKey reads the kind a key was built from", () => {
  assert.equal(disclosureKindFromKey(THINKING_A), "thinking");
  assert.equal(disclosureKindFromKey(TOOL), "tool");
  // A `useId()` fallback is not a disclosure key, so it belongs to no family.
  assert.equal(disclosureKindFromKey(":r1:"), undefined);
  assert.equal(disclosureKindFromKey("[]"), undefined);
  assert.equal(disclosureKindFromKey("[not-json"), undefined);
});

test("the controller mirrors the pane state and toggles it", () => {
  const choices = paneWithThinking({ openThinking: false });
  const controller = createThinkingDisclosureController(choices);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => {
    notifications += 1;
  });

  assert.equal(controller.getState(), "collapsed");
  controller.toggle();
  assert.equal(controller.getState(), "expanded");
  assert.equal(notifications > 0, true);

  const settled = notifications;
  controller.toggle();
  assert.equal(controller.getState(), "collapsed");
  assert.equal(notifications > settled, true);

  unsubscribe();
  const afterUnsubscribe = notifications;
  controller.toggle();
  assert.equal(notifications, afterUnsubscribe);
});
