import assert from "node:assert/strict";
import test from "node:test";
import { conversationBefore, conversationPrompt } from "../lib/conversation.ts";

const root = {
  id: "root", question: "Paris için bir rota öner.", createdAt: 1, updated: 10,
  result: { question: "Paris için bir rota öner.", finalAnswer: "Louvre ile başla." },
};
const first = {
  id: "first", question: "Peki Lyon için?", createdAt: 2, updated: 2,
  parentRunId: root.id, followUpPrompt: "previous prompt",
  result: { question: "previous prompt", finalAnswer: "Vieux Lyon ile başla." },
};
const second = {
  id: "second", question: "Oraya nasıl giderim?", createdAt: 3, updated: 3,
  parentRunId: first.id, followUpPrompt: "previous prompt",
};
const sibling = { ...first, id: "sibling", question: "Marsilya için?", updated: 4 };

test("uses the parent chain and presents earlier turns in conversational order", () => {
  const turns = conversationBefore([root, sibling, first, second], second);
  assert.deepEqual(turns.map(turn => turn.id), ["root", "first"]);
  const prompt = conversationPrompt(second.question, turns);
  assert.ok(prompt.indexOf(root.question) < prompt.indexOf(first.question));
  assert.ok(prompt.includes(first.result.finalAnswer));
  assert.ok(prompt.endsWith(second.question));
  assert.doesNotMatch(prompt, /Marsilya|previous prompt/);
});

test("reconstructs older turns using their saved order", () => {
  const oldRoot = { ...root, createdAt: undefined, updated: 1 };
  const oldFirst = { ...first, createdAt: undefined, parentRunId: undefined };
  const oldSecond = { ...second, createdAt: undefined, parentRunId: undefined };
  assert.deepEqual(conversationBefore([oldSecond, oldFirst, oldRoot], oldSecond), [oldRoot, oldFirst]);
});

test("reserves space for recent answers and preserves CSV evidence after the question", () => {
  const csvRoot = { ...root, result: { ...root.result, question: root.question + "\n\nCSV analysis context\nFile evidence" } };
  const longTurns = Array.from({ length: 10 }, (_, index) => ({
    ...first, question: `Follow-up ${index}`, result: { ...first.result, finalAnswer: "x".repeat(15_000) },
  }));
  const prompt = conversationPrompt(second.question, [csvRoot, ...longTurns]);
  assert.doesNotMatch(prompt, /Follow-up 0/);
  assert.match(prompt, /Follow-up 9/);
  assert.ok(prompt.endsWith(second.question + "\n\nCSV analysis context\nFile evidence"));
});

test("uses a new CSV for a follow-up and retains it for the next turn", () => {
  const marker = "\n\nCSV analysis context\n";
  const csvRoot = { ...root, result: { ...root.result, question: root.question + marker + "Original CSV" } };
  const attachment = marker + "New CSV";
  const attachedTurn = { ...first, followUpPrompt: conversationPrompt(first.question, [csvRoot], attachment) };
  assert.ok(attachedTurn.followUpPrompt.endsWith(first.question + attachment));
  assert.doesNotMatch(attachedTurn.followUpPrompt, /Original CSV/);
  assert.ok(conversationPrompt(second.question, [csvRoot, attachedTurn]).endsWith(second.question + attachment));
});
