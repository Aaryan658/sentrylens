import { describe, it, expect } from "vitest";
import { mergeNerTokens } from "./ner.js";

// These raw-token shapes are copied verbatim from a live probe of
// onnx-community/multilang-pii-ner-ONNX (transformers.js@3.7.1) run against
// "A. Menon" and "Menon" — the model emits one prediction per wordpiece, all
// tagged "B-" (never "I-"), with no start/end. The period between "A" and
// "Menon" was classified "O" and is absent from the pipeline's output (its
// default ignore_labels filters "O"), which is what creates the gap this
// test's MERGE_GAP has to bridge.

describe("mergeNerTokens", () => {
  it("merges 'A. Menon' into one PERSON_NAME span despite a filtered token gap and no I- tags", () => {
    const chunk = "A. Menon";
    const tokens = [
      { entity: "B-GIVENNAME", score: 0.68, word: "A" },
      { entity: "B-GIVENNAME", score: 0.71, word: "Men" },
      { entity: "B-GIVENNAME", score: 0.6, word: "on" },
    ];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ category: "PERSON_NAME", value: "A. Menon", start: 0, end: 8 });
  });

  it("merges contiguous wordpieces of a plain surname", () => {
    const chunk = "Menon";
    const tokens = [
      { entity: "B-GIVENNAME", score: 0.81, word: "Men" },
      { entity: "B-GIVENNAME", score: 0.7, word: "on" },
    ];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans).toEqual([{ category: "PERSON_NAME", value: "Menon", start: 0, end: 5 }]);
  });

  it("keeps a name found later in a larger chunk at the right offset", () => {
    const chunk = "Duty roster Operator A. Menon Phone 9000000000";
    const tokens = [
      { entity: "B-GIVENNAME", score: 0.68, word: "A" },
      { entity: "B-GIVENNAME", score: 0.71, word: "Men" },
      { entity: "B-GIVENNAME", score: 0.6, word: "on" },
    ];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(chunk.slice(span!.start, span!.end)).toBe("A. Menon");
  });

  it("offsets spans by `base` for windowed chunks", () => {
    const chunk = "Menon";
    const tokens = [{ entity: "B-GIVENNAME", score: 0.81, word: "Men" }, { entity: "B-GIVENNAME", score: 0.7, word: "on" }];
    const spans = mergeNerTokens(tokens, chunk, 100);
    expect(spans).toEqual([{ category: "PERSON_NAME", value: "Menon", start: 100, end: 105 }]);
  });

  it("drops a token below the score threshold", () => {
    const spans = mergeNerTokens([{ entity: "B-GIVENNAME", score: 0.2, word: "Menon" }], "Menon", 0);
    expect(spans).toEqual([]);
  });

  it("drops a token whose label isn't in LABEL_MAP", () => {
    const spans = mergeNerTokens([{ entity: "B-MISC", score: 0.9, word: "Foo" }], "Foo", 0);
    expect(spans).toEqual([]);
  });

  it("does not merge across an unrelated category in between", () => {
    const chunk = "Menon ops@vssc.test Rao";
    const tokens = [
      { entity: "B-GIVENNAME", score: 0.8, word: "Menon" },
      { entity: "B-EMAIL", score: 0.9, word: "ops@vssc.test" },
      { entity: "B-GIVENNAME", score: 0.8, word: "Rao" },
    ];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans.map((s) => s.category)).toEqual(["PERSON_NAME", "EMAIL", "PERSON_NAME"]);
    expect(spans[0]!.value).toBe("Menon");
    expect(spans[2]!.value).toBe("Rao");
  });

  it("does not merge two same-category names separated by more than MERGE_GAP", () => {
    const chunk = "Menon      Rao";
    const tokens = [
      { entity: "B-GIVENNAME", score: 0.8, word: "Menon" },
      { entity: "B-GIVENNAME", score: 0.8, word: "Rao" },
    ];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans).toHaveLength(2);
  });

  it("prefers real start/end when the pipeline provides them", () => {
    const chunk = "call Anita Rao now";
    const tokens = [{ entity_group: "PER", score: 0.9, word: "Anita Rao", start: 5, end: 14 }];
    const spans = mergeNerTokens(tokens, chunk, 0);
    expect(spans).toEqual([{ category: "PERSON_NAME", value: "Anita Rao", start: 5, end: 14 }]);
  });
});
